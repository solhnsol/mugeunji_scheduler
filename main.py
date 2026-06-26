import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List, Optional

import aiosqlite
from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel, Field

from src.auth import AuthManager
from src.automation_config import RESERVATION_FREE, RESERVATION_MONTHLY, ScheduleConfig
from src.database import init_db
from src.membership import MembershipManager, period_from_offset
from src.reservation import ReservationManager
from src.settings import SettingsManager

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_json(self, data: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(data)
            except Exception:
                self.disconnect(connection)


connection_manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = await init_db()
    app.state.db_conn = conn
    yield
    await conn.close()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def get_db_conn():
    return app.state.db_conn


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


class LoginInfo(BaseModel):
    username: str
    password: str


class RegisterInfo(BaseModel):
    username: str = Field(..., min_length=2)
    password: str = Field(..., min_length=4)
    email: str = Field(..., min_length=5)
    name: str = Field(..., min_length=2)
    phone: str = Field(..., min_length=9)


class PlanApplyRequest(BaseModel):
    plan_id: int = Field(..., ge=1)


class OpenSettlementRequest(BaseModel):
    period: Optional[str] = None


class ConfirmPaymentRequest(BaseModel):
    billing_id: int


class UpdateUserMembershipRequest(BaseModel):
    allowed_hours: Optional[int] = Field(None, ge=4, le=8)
    free_access: Optional[bool] = None
    custom_monthly_fee: Optional[int] = Field(None, ge=0)
    clear_custom_fee: bool = False


class UpdatePlanPriceRequest(BaseModel):
    monthly_price: int = Field(..., ge=0)


class UpdateSettingsRequest(BaseModel):
    reservation_enabled: bool
    reservation_opens_at: Optional[str] = None


class UpdateAutomationRequest(BaseModel):
    reservation_enabled: bool
    auto_monthly_open_enabled: bool = True
    monthly_open_hour: int = Field(21, ge=0, le=23)
    monthly_open_minute: int = Field(0, ge=0, le=59)
    monthly_clear_minutes_before: int = Field(20, ge=0, le=1440)
    auto_monthly_clear_enabled: bool = True
    auto_free_reset_enabled: bool = True
    free_reset_weekday: int = Field(6, ge=0, le=6)
    free_reset_hour: int = Field(20, ge=0, le=23)
    free_reset_minute: int = Field(59, ge=0, le=59)
    free_booking_start_hour: int = Field(21, ge=0, le=23)
    free_booking_start_minute: int = Field(0, ge=0, le=59)
    free_booking_window_hours: int = Field(24, ge=1, le=48)


class ReservationItem(BaseModel):
    day: str
    time_index: int


class ReservationList(BaseModel):
    reservations: List[ReservationItem]


class ForceReservationRequest(BaseModel):
    target_username: str
    reservations: List[ReservationItem]


class UserInfoResponse(BaseModel):
    username: str
    allowed_hours: int
    role: str
    free_access: bool = False
    email: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    plan_name: Optional[str] = None
    subscription_status: Optional[str] = None
    monthly_price: Optional[int] = None


class PlanResponse(BaseModel):
    id: int
    name: str
    allowed_hours: int
    monthly_price: int


class SettingsResponse(BaseModel):
    reservation_enabled: bool
    reservation_opens_at: Optional[str] = None
    next_monthly_open_at: Optional[str] = None
    schedule_message: Optional[str] = None


async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증이 필요합니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return {"username": username, "role": role}


async def get_current_admin_user(token: str = Depends(oauth2_scheme)):
    user = await get_current_user(token)
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
    return user


async def broadcast_reservation_updates(conn: aiosqlite.Connection):
    reserve_manager = ReservationManager(conn)
    monthly = await reserve_manager.get_reservations(RESERVATION_MONTHLY)
    free = await reserve_manager.get_reservations(RESERVATION_FREE)
    await connection_manager.broadcast_json({"type": "RESERVATION_UPDATE", "data": monthly})
    await connection_manager.broadcast_json({"type": "FREE_RESERVATION_UPDATE", "data": free})


@app.post("/register")
async def register_user(data: RegisterInfo, conn: aiosqlite.Connection = Depends(get_db_conn)):
    auth_manager = AuthManager(conn)
    is_success, message = await auth_manager.register(
        data.username, data.password, data.email, data.name, data.phone
    )
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/plans", response_model=List[PlanResponse])
async def list_plans(conn: aiosqlite.Connection = Depends(get_db_conn)):
    membership = MembershipManager(conn)
    return await membership.get_plans()


@app.get("/me")
async def get_me(current_user: dict = Depends(get_current_user), conn: aiosqlite.Connection = Depends(get_db_conn)):
    membership = MembershipManager(conn)
    access = await membership.get_access_status(current_user["username"])
    user = await membership.get_user_row(current_user["username"])
    role = current_user["role"]
    can_free = role in ("free", "admin") and (role == "admin" or access.get("can_access_schedule", False))
    return {
        "username": current_user["username"],
        "role": role,
        "email": user.get("email") if user else None,
        "name": user.get("name") if user else None,
        "phone": user.get("phone") if user else None,
        "can_access_free_schedule": can_free,
        **access,
    }


@app.post("/plans/apply")
async def apply_plan(
    data: PlanApplyRequest,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.apply_for_plan(current_user["username"], data.plan_id)
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/plans/change")
async def change_plan(
    data: PlanApplyRequest,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.request_plan_change(current_user["username"], data.plan_id)
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/plans/cancel")
async def cancel_plan(current_user: dict = Depends(get_current_user), conn: aiosqlite.Connection = Depends(get_db_conn)):
    membership = MembershipManager(conn)
    is_success, message = await membership.request_cancellation(current_user["username"])
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/plans/cancel/revoke")
async def revoke_plan_cancellation(
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.revoke_cancellation(current_user["username"])
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/login")
async def login_user(data: LoginInfo, conn: aiosqlite.Connection = Depends(get_db_conn)):
    auth_manager = AuthManager(conn)
    user_data = await auth_manager.login(data.username, data.password)
    if not user_data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    access_token_data = {"sub": user_data["username"], "role": user_data["role"]}
    access_token = create_access_token(data=access_token_data)
    membership = MembershipManager(conn)
    access = await membership.get_access_status(user_data["username"])
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "allowed_hours": user_data["allowed_hours"],
        "access_status": access["access_status"],
        "can_access_schedule": access["can_access_schedule"],
    }


@app.post("/admin/login")
async def admin_login(data: LoginInfo, conn: aiosqlite.Connection = Depends(get_db_conn)):
    auth_manager = AuthManager(conn)
    user_data = await auth_manager.login(data.username, data.password)
    if not user_data or user_data["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="관리자 인증에 실패했습니다.")
    access_token = create_access_token(data={"sub": user_data["username"], "role": user_data["role"]})
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/settings", response_model=SettingsResponse)
async def get_public_settings(conn: aiosqlite.Connection = Depends(get_db_conn)):
    reserve_manager = ReservationManager(conn)
    status = await reserve_manager.get_public_schedule_status()
    return status


@app.post("/reserve")
async def reserve_time(
    data: ReservationList,
    token: str = Depends(oauth2_scheme),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    username = payload.get("sub")
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    is_success, message = await reserve_manager.create_reservation(username, reserve_times_list)
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": str(message)}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/free/reserve")
async def reserve_free_time(
    data: ReservationList,
    token: str = Depends(oauth2_scheme),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    username = payload.get("sub")
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    is_success, message = await reserve_manager.create_free_reservation(username, reserve_times_list)
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": str(message)}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/free/schedule")
async def get_free_schedule(
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    can_access, msg = await reserve_manager._user_can_access_free(current_user["username"])
    if not can_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)
    reservations = await reserve_manager.get_reservations(RESERVATION_FREE)
    monthly = await reserve_manager.get_reservations(RESERVATION_MONTHLY)
    meta = await reserve_manager.get_free_schedule_meta()
    return {"free_reservations": reservations, "monthly_reservations": monthly, **meta}


@app.get("/free/weekly-usage")
async def get_free_weekly_usage(
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    can_access, msg = await reserve_manager._user_can_access_free(current_user["username"])
    if not can_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=msg)
    return await reserve_manager.get_weekly_usage(RESERVATION_FREE)


@app.get("/admin/users", response_model=List[UserInfoResponse])
async def get_all_users_by_admin(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    users = await membership.list_users_with_membership()
    result = []
    for user in users:
        hours = user["custom_allowed_hours"] if user.get("custom_allowed_hours") is not None else user.get("allowed_hours", 0)
        price = user["custom_monthly_fee"] if user.get("custom_monthly_fee") is not None else user.get("plan_monthly_price")
        result.append({
            "username": user["username"],
            "allowed_hours": hours,
            "role": user["role"],
            "free_access": user["role"] == "free",
            "email": user.get("email"),
            "name": user.get("name"),
            "phone": user.get("phone"),
            "plan_name": user.get("plan_name"),
            "subscription_status": user.get("subscription_status"),
            "monthly_price": price,
        })
    return result


@app.put("/admin/users/{username}")
async def update_user_membership(
    username: str,
    data: UpdateUserMembershipRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.update_user_membership(
        username,
        allowed_hours=data.allowed_hours,
        free_access=data.free_access,
        custom_monthly_fee=data.custom_monthly_fee,
        clear_custom_fee=data.clear_custom_fee,
    )
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/admin/settlement")
async def get_settlement_overview(
    period: Optional[str] = None,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    open_settlement = await membership.get_open_settlement()
    target_period = period or (open_settlement or {}).get("period") or period_from_offset(1)
    summary = await membership.get_settlement_summary(target_period)
    return {
        "suggested_next_period": period_from_offset(1),
        "open_settlement": open_settlement,
        "current_access_period": await membership.get_access_period(),
        **summary,
    }


@app.post("/admin/settlement/open")
async def open_settlement(
    data: OpenSettlementRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    period = data.period or period_from_offset(1)
    is_success, message = await membership.open_settlement(period, admin_user["username"])
    if is_success:
        return {"status": "success", "message": message, "period": period}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/settlement/close")
async def close_settlement(
    data: OpenSettlementRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    open_settlement = await membership.get_open_settlement()
    if not open_settlement:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="열려 있는 정산이 없습니다.")
    period = data.period or open_settlement["period"]
    is_success, message = await membership.close_settlement(period)
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/admin/billing")
async def list_billing(
    period: Optional[str] = None,
    billing_status: Optional[str] = None,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    return await membership.list_billing_cycles(period=period, status=billing_status)


@app.post("/admin/billing/confirm")
async def confirm_billing_payment(
    data: ConfirmPaymentRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.confirm_payment(data.billing_id, admin_user["username"])
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/admin/settlement/copy-text")
async def get_settlement_copy_text(
    period: str,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    summary = await membership.get_settlement_summary(period)
    return {"text": membership.build_settlement_copy_text(summary)}


@app.put("/admin/plans/{plan_id}")
async def update_plan_price(
    plan_id: int,
    data: UpdatePlanPriceRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    async with conn.execute("SELECT id FROM plans WHERE id = ?", (plan_id,)) as cursor:
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="요금제를 찾을 수 없습니다.")
    await conn.execute("UPDATE plans SET monthly_price = ? WHERE id = ?", (data.monthly_price, plan_id))
    await conn.commit()
    return {"status": "success", "message": "요금제 가격이 수정되었습니다."}


@app.get("/admin/settings", response_model=SettingsResponse)
async def get_admin_settings(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    settings_manager = SettingsManager(conn)
    settings = await settings_manager.get_settings()
    return {
        "reservation_enabled": settings.get("reservation_enabled") == "true",
        "reservation_opens_at": settings.get("reservation_opens_at"),
    }


@app.put("/admin/settings")
async def update_admin_settings(
    data: UpdateSettingsRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    settings_manager = SettingsManager(conn)
    opens_at = data.reservation_opens_at.strip() if data.reservation_opens_at else None
    if opens_at == "":
        opens_at = None
    payload = {
        "reservation_enabled": str(data.reservation_enabled).lower(),
        "reservation_opens_at": opens_at,
    }
    is_success, message = await settings_manager.upsert_settings(payload)
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=message)


@app.get("/admin/automation")
async def get_automation_settings(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    return await reserve_manager.get_automation_status()


@app.put("/admin/automation")
async def update_automation_settings(
    data: UpdateAutomationRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    settings_manager = SettingsManager(conn)
    config = ScheduleConfig(
        auto_monthly_open_enabled=data.auto_monthly_open_enabled,
        monthly_open_hour=data.monthly_open_hour,
        monthly_open_minute=data.monthly_open_minute,
        monthly_clear_minutes_before=data.monthly_clear_minutes_before,
        auto_monthly_clear_enabled=data.auto_monthly_clear_enabled,
        auto_free_reset_enabled=data.auto_free_reset_enabled,
        free_reset_weekday=data.free_reset_weekday,
        free_reset_hour=data.free_reset_hour,
        free_reset_minute=data.free_reset_minute,
        free_booking_start_hour=data.free_booking_start_hour,
        free_booking_start_minute=data.free_booking_start_minute,
        free_booking_window_hours=data.free_booking_window_hours,
    )
    payload = {
        "reservation_enabled": str(data.reservation_enabled).lower(),
        **config.to_settings_dict(),
    }
    is_success, message = await settings_manager.upsert_settings(payload)
    if not is_success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=message)
    reserve_manager = ReservationManager(conn)
    await reserve_manager.check_reservation_availability()
    await broadcast_reservation_updates(conn)
    status_data = await reserve_manager.get_automation_status()
    return {"status": "success", "message": message, **status_data}


@app.post("/admin/reservations/create")
async def admin_force_reserve(
    data: ForceReservationRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    is_success, message = await reserve_manager.force_create_reservation(
        data.target_username, reserve_times_list
    )
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/reservations/delete")
async def admin_delete_reservations(
    data: ReservationList,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    is_success, message = await reserve_manager.delete_reservations(reserve_times_list)
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/admin/reservations/clear")
async def admin_clear_reservations(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    is_success, message = await reserve_manager.clear_reservations()
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/users/upload-csv")
async def upload_users_csv(
    file: UploadFile = File(...),
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    auth_manager = AuthManager(conn)
    content = (await file.read()).decode("utf-8-sig")
    is_success, message = await auth_manager.update_users(content)
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    conn = websocket.app.state.db_conn
    reserve_manager = ReservationManager(conn)
    await connection_manager.connect(websocket)
    await reserve_manager.check_reservation_availability()
    try:
        monthly = await reserve_manager.get_reservations(RESERVATION_MONTHLY)
        free = await reserve_manager.get_reservations(RESERVATION_FREE)
        await websocket.send_json({"type": "RESERVATION_UPDATE", "data": monthly})
        await websocket.send_json({"type": "FREE_RESERVATION_UPDATE", "data": free})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_manager.disconnect(websocket)


def _spa_index():
    index_path = "static/dist/index.html"
    if not os.path.exists(index_path):
        raise HTTPException(
            status_code=503,
            detail="프론트엔드가 빌드되지 않았습니다. frontend 폴더에서 npm run build를 실행하세요.",
        )
    return FileResponse(index_path)


if os.path.isdir("static/dist/assets"):
    app.mount("/assets", StaticFiles(directory="static/dist/assets"), name="assets")


@app.get("/")
async def read_index():
    return _spa_index()


@app.get("/admin")
async def read_admin_index():
    return _spa_index()


@app.get("/free")
async def read_free_index():
    return _spa_index()
