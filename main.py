import time
import asyncio
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Literal

import aiosqlite
from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    Request,
    Response,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel, Field

from src.auth import AuthManager, is_profile_complete
from src.automation_config import RESERVATION_FREE, RESERVATION_MONTHLY, ScheduleConfig, now_kst
from src.database import init_db
from src.membership import MembershipManager, period_from_offset, usage_period
from src.reservation import ReservationManager
from src.settings import SettingsManager
from src.notices import NoticeError, NoticeManager
from src.booking import MODE_BETA, MODE_LEGACY, MODE_TOKEN, BookingError, BookingManager
from src.tokens import TokenManager, is_expired

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 로그인 유지 30일
SESSION_COOKIE = "session"
# 임시 비밀번호 상태에서도 허용하는 경로 (현재 상태 확인, 비밀번호 변경)
MUST_CHANGE_ALLOWED_PATHS = {"/me", "/me/profile"}

if SECRET_KEY in ("change-me-in-production", "change-me-to-a-long-random-string"):
    # 공개된 기본 키로는 누구나 로그인 토큰(관리자 포함)을 위조할 수 있다. 임시 키를 쓰고(재시작하면 로그아웃됨) 알린다.
    SECRET_KEY = secrets.token_urlsafe(48)
    print("[WARN] SECRET_KEY가 기본값이라 임시 키로 실행합니다 (재시작하면 모두 로그아웃돼요). .env에 긴 임의 문자열을 설정하세요.")
elif len(SECRET_KEY) < 32:
    print("[WARN] SECRET_KEY가 짧습니다. 32자 이상의 임의 문자열을 권장합니다.")
if not os.getenv("ADMIN_PASSWORD"):
    print("[WARN] ADMIN_PASSWORD가 없어 새 DB에서는 admin 계정이 생성되지 않습니다.")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login", auto_error=False)


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

_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith("/api/") or request.url.path in ("/me", "/settings"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


# 단일 DB 연결을 공유하므로 쓰기 요청은 직렬화해 트랜잭션 간 commit/rollback 간섭을 막는다.
# 이 락은 프로세스 단위이므로 uvicorn 워커는 반드시 1개로 실행해야 한다 (Dockerfile 참고).
_write_lock = asyncio.Lock()
_LOCK_EXEMPT = {"/login", "/admin/login", "/logout"}


@app.middleware("http")
async def serialize_writes(request: Request, call_next):
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return await call_next(request)
    # 쿠키 인증 요청의 CSRF 방어: 다른 사이트에서 온 쓰기 요청은 거부 (SameSite=Lax와 이중 방어)
    origin = request.headers.get("origin")
    if origin and request.cookies.get(SESSION_COOKIE):
        host = request.headers.get("host", "")
        if origin.split("://", 1)[-1] != host and origin not in _cors_origins:
            return JSONResponse(status_code=403, content={"detail": "허용되지 않은 요청 출처입니다."})
    if request.url.path in _LOCK_EXEMPT:
        return await call_next(request)
    async with _write_lock:
        return await call_next(request)


async def get_db_conn():
    return app.state.db_conn


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "jti": uuid.uuid4().hex})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


class LoginInfo(BaseModel):
    username: str
    password: str


class RegisterInfo(BaseModel):
    username: str = Field(..., min_length=2)
    password: str = Field(..., min_length=6)
    name: str = Field(..., min_length=2)
    phone: str = Field(..., min_length=9)


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2)
    phone: Optional[str] = Field(None, min_length=9)
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(None, min_length=6)


class PlanApplyRequest(BaseModel):
    plan_id: int = Field(..., ge=1)
    start_period: Optional[Literal["current", "next"]] = "next"


class BillingPeriodRequest(BaseModel):
    period: Optional[str] = None


class RosterAddRequest(BaseModel):
    username: str = Field(..., min_length=1)
    period: str = Field(..., min_length=7, max_length=7)
    plan_id: int = Field(..., ge=1)
    allowed_hours: Optional[int] = Field(None, ge=0, le=24)
    custom_monthly_fee: Optional[int] = Field(None, ge=0)
    free_access: Optional[bool] = None


class RosterRemoveRequest(BaseModel):
    username: str = Field(..., min_length=1)
    period: str = Field(..., min_length=7, max_length=7)


class ConfirmPaymentRequest(BaseModel):
    billing_id: int


class UnconfirmPaymentRequest(BaseModel):
    billing_id: Optional[int] = None
    period: Optional[str] = None


class SetAccessPeriodRequest(BaseModel):
    period: str = Field(..., min_length=7, max_length=7)


class UpdateUserMembershipRequest(BaseModel):
    allowed_hours: Optional[int] = Field(None, ge=0, le=24)
    plan_id: Optional[int] = Field(None, ge=1)
    free_access: Optional[bool] = None
    custom_monthly_fee: Optional[int] = Field(None, ge=0)
    clear_custom_hours: bool = False
    clear_custom_fee: bool = False


class UpdateAdminHoursRequest(BaseModel):
    allowed_hours: int = Field(..., ge=1, le=24)


class UpdatePlanPriceRequest(BaseModel):
    monthly_price: int = Field(..., ge=0)


class UpdateUserProfileRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2)
    phone: Optional[str] = Field(None, min_length=9)


class TokenPackCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
    price_won: int = Field(..., ge=0)
    tokens: int = Field(..., ge=1)
    auto_confirm: bool = False
    expires_on: Optional[str] = None
    audience: Literal["all", "free"] = "all"


class TokenPackUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=30)
    price_won: Optional[int] = Field(None, ge=0)
    tokens: Optional[int] = Field(None, ge=1)
    sort_order: Optional[int] = None
    active: Optional[bool] = None
    auto_confirm: Optional[bool] = None
    expires_on: Optional[str] = None
    clear_expires_on: bool = False
    audience: Optional[Literal["all", "free"]] = None


class TokenPurchaseRequest(BaseModel):
    pack_id: int = Field(..., ge=1)


class TokenAdjustRequest(BaseModel):
    username: str = Field(..., min_length=1)
    tokens: int
    memo: str = Field(..., min_length=1, max_length=200)
    expires_on: Optional[str] = None


class TokenGrantRequest(BaseModel):
    usernames: List[str] = Field(..., min_length=1, max_length=500)
    tokens: int = Field(..., ge=1)
    memo: str = Field(..., min_length=1, max_length=200)
    expires_on: Optional[str] = None


class RejectPurchaseRequest(BaseModel):
    memo: Optional[str] = Field(None, max_length=200)


class NoticeCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    body: str = Field("", max_length=20000)
    category: Literal["notice", "guide"] = "notice"
    visibility: Literal["public", "members"] = "members"
    pinned: bool = False
    published: bool = False


class NoticeUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    body: Optional[str] = Field(None, max_length=20000)
    category: Optional[Literal["notice", "guide"]] = None
    visibility: Optional[Literal["public", "members"]] = None
    pinned: Optional[bool] = None
    published: Optional[bool] = None


class TokenSettingsRequest(BaseModel):
    token_charge_enabled: bool


class BookingSlot(BaseModel):
    date: str
    hour: int = Field(..., ge=0, le=23)


class BookingCreateRequest(BaseModel):
    slots: List[BookingSlot] = Field(..., min_length=1, max_length=168)


class BookingCancelRequest(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=168)


class AdminBookingCreateRequest(BaseModel):
    username: str = Field(..., min_length=1)
    slots: List[BookingSlot] = Field(..., min_length=1, max_length=168)


class AdminBookingCancelRequest(BaseModel):
    # None이면 환불 정책대로, True면 전액 환불, False면 환불 없음
    refund: Optional[bool] = None


class PriceBandModel(BaseModel):
    start: int
    end: int
    cost: int


class RefundTierModel(BaseModel):
    hours_before: int
    percent: int


class BookingSettingsRequest(BaseModel):
    reservation_mode: Optional[Literal["legacy", "beta", "token"]] = None
    beta_month: Optional[str] = None
    price_bands: Optional[List[PriceBandModel]] = None
    refund_tiers: Optional[List[RefundTierModel]] = None


class DawnPermissionRequest(BaseModel):
    allowed: bool


class UpdateSettingsRequest(BaseModel):
    reservation_enabled: bool
    reservation_opens_at: Optional[str] = None


class UpdatePaymentGuideRequest(BaseModel):
    payment_guide: str = Field("", max_length=1000)


class UpdateAutomationRequest(BaseModel):
    reservation_enabled: bool
    auto_monthly_open_enabled: bool = True
    monthly_open_hour: int = Field(21, ge=0, le=23)
    monthly_open_minute: int = Field(0, ge=0, le=59)
    monthly_clear_minutes_before: int = Field(20, ge=0, le=1440)
    auto_monthly_clear_enabled: bool = True
    reservation_opens_at: Optional[str] = None
    clear_reservation_opens_at: bool = False
    auto_free_reset_enabled: bool = True
    free_reset_weekday: int = Field(6, ge=0, le=6)
    free_reset_hour: int = Field(20, ge=0, le=23)
    free_reset_minute: int = Field(59, ge=0, le=59)
    free_booking_start_hour: int = Field(21, ge=0, le=23)
    free_booking_start_minute: int = Field(0, ge=0, le=59)
    free_booking_window_hours: int = Field(24, ge=1, le=48)


class ReservationItem(BaseModel):
    day: Literal["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    time_index: int = Field(..., ge=0, le=23)


class ReservationList(BaseModel):
    reservations: List[ReservationItem] = Field(..., min_length=1, max_length=200)


class ForceReservationRequest(BaseModel):
    target_username: str = Field(..., min_length=1)
    reservations: List[ReservationItem] = Field(..., min_length=1, max_length=200)
    reservation_type: Literal["monthly", "free"] = "monthly"


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
    custom_monthly_fee: Optional[int] = None
    custom_allowed_hours: Optional[int] = None
    plan_id: Optional[int] = None
    plan_allowed_hours: Optional[int] = None
    dawn_allowed: Optional[bool] = None


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
    payment_guide: Optional[str] = None
    token_charge_enabled: bool = False
    reservation_mode: str = "legacy"
    beta_month: str = ""


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    secure = (
        request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


async def _user_from_token(token: Optional[str], conn: aiosqlite.Connection, path: str = "") -> dict:
    """로그인 토큰을 검증해 사용자를 돌려준다. 실패하면 401/403 HTTPException."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증이 필요합니다. 다시 로그인해주세요.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    jti = payload.get("jti")
    if jti:
        async with conn.execute("SELECT 1 FROM revoked_tokens WHERE jti = ?", (jti,)) as cursor:
            if await cursor.fetchone():
                raise credentials_exception
    # 역할은 토큰이 아닌 DB 기준 (관리자가 권한을 바꾸거나 계정이 삭제된 경우 즉시 반영)
    async with conn.execute(
        "SELECT role, session_epoch, must_change_password FROM users WHERE username = ?", (username,)
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        raise credentials_exception
    # 비밀번호 변경/초기화 이후에는 이전에 발급된 토큰을 받지 않는다
    if int(payload.get("ep", 0)) != int(row["session_epoch"] or 0):
        raise credentials_exception
    # 임시 비밀번호로 로그인한 상태에서는 새 비밀번호를 설정하기 전까지 다른 기능을 막는다
    if row["must_change_password"] and path not in MUST_CHANGE_ALLOWED_PATHS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="새 비밀번호를 먼저 설정해주세요.")
    return {"username": username, "role": row["role"]}


async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    return await _user_from_token(token or request.cookies.get(SESSION_COOKIE), conn, request.url.path)


async def get_optional_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    conn: aiosqlite.Connection = Depends(get_db_conn),
) -> Optional[dict]:
    """로그인했으면 사용자, 아니면 None (로그인 전 방문자도 볼 수 있는 API용)."""
    try:
        return await get_current_user(request, token, conn)
    except HTTPException:
        return None


async def get_current_admin_user(user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
    return user


async def broadcast_reservation_updates(conn: aiosqlite.Connection):
    reserve_manager = ReservationManager(conn)
    monthly = await reserve_manager.get_reservations(RESERVATION_MONTHLY)
    free = await reserve_manager.get_reservations(RESERVATION_FREE)
    await connection_manager.broadcast_json({"type": "RESERVATION_UPDATE", "data": monthly})
    await connection_manager.broadcast_json({"type": "FREE_RESERVATION_UPDATE", "data": free})


async def broadcast_booking_update(dates: List[str]):
    """토큰 예약이 바뀐 날짜를 접속 중인 화면에 알려 새로 불러오게 한다."""
    await connection_manager.broadcast_json({"type": "BOOKING_UPDATE", "dates": dates})


# 가입 남용 방지: 같은 접속 IP에서 1시간에 가입할 수 있는 횟수 (재시작하면 초기화)
_REGISTER_WINDOW_SEC = 3600
_REGISTER_MAX_PER_IP = 10
_register_attempts: Dict[str, List[float]] = {}


@app.post("/register")
async def register_user(data: RegisterInfo, request: Request, conn: aiosqlite.Connection = Depends(get_db_conn)):
    now = time.time()
    ip = _client_ip(request)
    recent = [t for t in _register_attempts.get(ip, []) if now - t < _REGISTER_WINDOW_SEC]
    if len(recent) >= _REGISTER_MAX_PER_IP:
        _register_attempts[ip] = recent
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="가입 시도가 너무 많아요. 잠시 뒤에 다시 시도하거나 오픈채팅으로 문의해주세요.",
        )
    recent.append(now)
    _register_attempts[ip] = recent
    auth_manager = AuthManager(conn)
    is_success, message = await auth_manager.register(
        data.username, data.password, data.name, data.phone
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
    can_free = role in ("free", "admin") and (
        role == "admin" or access.get("can_access_current_month", False)
    )
    profile_complete = is_profile_complete(user)
    return {
        "username": current_user["username"],
        "role": role,
        "name": user.get("name") if user else None,
        "phone": user.get("phone") if user else None,
        "profile_complete": profile_complete,
        "must_change_password": bool(user and user.get("must_change_password")),
        "can_access_free_schedule": can_free,
        **access,
    }


@app.put("/me/profile")
async def update_my_profile(
    data: UpdateProfileRequest,
    request: Request,
    response: Response,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    auth_manager = AuthManager(conn)
    is_success, message = await auth_manager.update_profile(
        current_user["username"],
        name=data.name,
        phone=data.phone,
        current_password=data.current_password,
        new_password=data.new_password,
    )
    if is_success:
        user = await auth_manager.get_user_row(current_user["username"])
        if data.new_password and user:
            # 비밀번호가 바뀌면 이전 토큰은 무효가 되므로, 지금 기기에는 새 세션을 발급한다
            token = create_access_token(
                data={"sub": user["username"], "role": user["role"], "ep": user.get("session_epoch", 0)}
            )
            set_session_cookie(response, request, token)
        return {
            "status": "success",
            "message": message,
            "name": user.get("name") if user else None,
            "phone": user.get("phone") if user else None,
            "profile_complete": is_profile_complete(user),
        }
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/plans/apply")
async def apply_plan(
    data: PlanApplyRequest,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.apply_for_plan(
        current_user["username"], data.plan_id, data.start_period
    )
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


# 로그인 무차별 대입 방지: (접속 IP, 아이디)별 / IP별 실패 횟수를 메모리에 세어 잠시 막는다 (재시작하면 초기화).
_LOGIN_WINDOW_SEC = 600
_LOGIN_MAX_PER_USER = 8
_LOGIN_MAX_PER_IP = 30
# 접속 IP를 바꿔가며 한 계정만 노리는 시도 (프록시 헤더 위조 등)를 막는 계정 단위 상한. 정상 사용에서는 닿지 않는 값.
_LOGIN_MAX_PER_ACCOUNT = 40
_login_failures: Dict[str, List[float]] = {}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()  # 신뢰하는 프록시가 덧붙인 마지막 값
    return forwarded or (request.client.host if request.client else "unknown")


def _recent_failures(key: str, now: float) -> List[float]:
    recent = [t for t in _login_failures.get(key, []) if now - t < _LOGIN_WINDOW_SEC]
    if recent:
        _login_failures[key] = recent
    else:
        _login_failures.pop(key, None)
    return recent


def _check_login_throttle(request: Request, username: str) -> None:
    now = time.time()
    ip = _client_ip(request)
    if (
        len(_recent_failures(f"u:{ip}:{username.lower()}", now)) >= _LOGIN_MAX_PER_USER
        or len(_recent_failures(f"i:{ip}", now)) >= _LOGIN_MAX_PER_IP
        or len(_recent_failures(f"a:{username.lower()}", now)) >= _LOGIN_MAX_PER_ACCOUNT
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도가 너무 많아요. 잠시(10분 정도) 뒤에 다시 시도해주세요.",
        )


def _record_login_failure(request: Request, username: str) -> None:
    now = time.time()
    ip = _client_ip(request)
    for key in (f"u:{ip}:{username.lower()}", f"i:{ip}", f"a:{username.lower()}"):
        _login_failures.setdefault(key, []).append(now)


def _clear_login_failures(request: Request, username: str) -> None:
    _login_failures.pop(f"u:{_client_ip(request)}:{username.lower()}", None)


@app.post("/login")
async def login_user(
    data: LoginInfo,
    request: Request,
    response: Response,
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    auth_manager = AuthManager(conn)
    username = data.username.strip()
    _check_login_throttle(request, username)
    user_data = await auth_manager.login(username, data.password)
    if not user_data:
        _record_login_failure(request, username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    _clear_login_failures(request, username)
    access_token_data = {"sub": user_data["username"], "role": user_data["role"], "ep": user_data.get("session_epoch", 0)}
    access_token = create_access_token(data=access_token_data)
    set_session_cookie(response, request, access_token)
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
async def admin_login(
    data: LoginInfo,
    request: Request,
    response: Response,
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    auth_manager = AuthManager(conn)
    username = data.username.strip()
    _check_login_throttle(request, username)
    user_data = await auth_manager.login(username, data.password)
    if not user_data or user_data["role"] != "admin":
        _record_login_failure(request, username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="관리자 인증에 실패했습니다.")
    _clear_login_failures(request, username)
    access_token = create_access_token(
        data={"sub": user_data["username"], "role": user_data["role"], "ep": user_data.get("session_epoch", 0)}
    )
    set_session_cookie(response, request, access_token)
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/logout")
async def logout(
    request: Request,
    response: Response,
    token: Optional[str] = Depends(oauth2_scheme),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    token = token or request.cookies.get(SESSION_COOKIE)
    response.delete_cookie(SESSION_COOKIE, path="/")
    if token:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except JWTError:
            payload = None
        if payload and payload.get("jti") and payload.get("exp"):
            expires_at = datetime.utcfromtimestamp(payload["exp"]).isoformat()
            async with _write_lock:
                try:
                    # 만료된 항목은 함께 정리
                    await conn.execute(
                        "DELETE FROM revoked_tokens WHERE expires_at < ?", (datetime.utcnow().isoformat(),)
                    )
                    await conn.execute(
                        "INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)",
                        (payload["jti"], expires_at),
                    )
                    await conn.commit()
                except Exception:
                    await conn.rollback()
    return {"status": "success"}


@app.get("/settings", response_model=SettingsResponse)
async def get_public_settings(
    user: Optional[dict] = Depends(get_optional_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    status = await reserve_manager.get_public_schedule_status()
    # 입금 안내(계좌 등)는 로그인한 회원에게만 보여준다
    if user is None:
        status["payment_guide"] = None
    if status.pop("did_clear", False):
        await broadcast_reservation_updates(conn)
    settings = await SettingsManager(conn).get_settings()
    status["token_charge_enabled"] = settings.get("token_charge_enabled") == "true"
    status["reservation_mode"] = settings.get("reservation_mode") or MODE_LEGACY
    status["beta_month"] = settings.get("beta_month") or ""
    return status


async def _require_legacy_mode(conn: aiosqlite.Connection, user: dict, allow_monthly: bool = False) -> None:
    """토큰 예약으로 전환된 뒤에는 기존 월/자유이용 예약을 회원이 쓸 수 없다.

    베타에서는 월 신청(allow_monthly)만 기존 방식으로 쓰고 자유이용은 막는다."""
    if user["role"] == "admin":
        return
    mode = await BookingManager(conn).get_mode()
    if mode == MODE_TOKEN:
        detail = "새 예약 시스템(토큰 예약)으로 전환됐어요. 토큰으로 예약해주세요."
    elif mode == MODE_BETA and not allow_monthly:
        detail = "베타 기간에는 자유이용 대신 토큰으로 예약해주세요."
    else:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def _require_token_mode(conn: aiosqlite.Connection, user: dict) -> None:
    """토큰 예약은 전환된 뒤에만 회원이 쓸 수 있다. 관리자는 전환 전에도 미리 써볼 수 있다."""
    if user["role"] == "admin":
        return
    if (await BookingManager(conn).get_mode()) not in (MODE_TOKEN, MODE_BETA):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="토큰 예약은 아직 열리지 않았어요.")


@app.post("/reserve")
async def reserve_time(
    data: ReservationList,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_legacy_mode(conn, current_user, allow_monthly=True)
    reserve_manager = ReservationManager(conn)
    username = current_user["username"]
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    conflicts = await BookingManager(conn).monthly_conflicts(reserve_times_list)
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"이미 토큰으로 예약된 시간이 있어 월 신청할 수 없어요: {', '.join(conflicts[:3])}{' 외' if len(conflicts) > 3 else ''}",
        )
    is_success, message = await reserve_manager.create_reservation(username, reserve_times_list)
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": str(message)}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/reserve/cancel")
async def cancel_reservation(
    data: ReservationList,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_legacy_mode(conn, current_user, allow_monthly=True)
    reserve_manager = ReservationManager(conn)
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    is_success, message = await reserve_manager.cancel_own_reservations(
        current_user["username"], reserve_times_list
    )
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": str(message)}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/free/reserve")
async def reserve_free_time(
    data: ReservationList,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_legacy_mode(conn, current_user)
    reserve_manager = ReservationManager(conn)
    username = current_user["username"]
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
        hours = await membership.get_monthly_allowed_hours(user["username"])
        price = user["custom_monthly_fee"] if user.get("custom_monthly_fee") is not None else user.get("plan_monthly_price")
        result.append({
            "username": user["username"],
            "allowed_hours": hours,
            "plan_id": user.get("plan_id"),
            "plan_allowed_hours": user.get("plan_allowed_hours"),
            "custom_allowed_hours": user.get("custom_allowed_hours"),
            "role": user["role"],
            "free_access": user["role"] == "free",
            "email": user.get("email"),
            "name": user.get("name"),
            "phone": user.get("phone"),
            "plan_name": user.get("plan_name"),
            "subscription_status": user.get("subscription_status"),
            "monthly_price": price,
            "custom_monthly_fee": user.get("custom_monthly_fee"),
            "dawn_allowed": bool(user.get("dawn_allowed", 1)),
        })
    return result


@app.get("/admin/admins", response_model=List[UserInfoResponse])
async def get_admin_users(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    admins = await membership.list_admin_users()
    result = []
    for user in admins:
        hours = await membership.get_monthly_allowed_hours(user["username"])
        result.append({
            "username": user["username"],
            "allowed_hours": hours,
            "plan_id": None,
            "plan_allowed_hours": None,
            "custom_allowed_hours": user.get("custom_allowed_hours"),
            "role": user["role"],
            "free_access": True,
            "email": user.get("email"),
            "name": user.get("name"),
            "phone": user.get("phone"),
            "plan_name": None,
            "subscription_status": None,
            "monthly_price": None,
        })
    return result


@app.put("/admin/admins/{username}")
async def update_admin_hours(
    username: str,
    data: UpdateAdminHoursRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.update_admin_hours(username, data.allowed_hours)
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


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
        plan_id=data.plan_id,
        free_access=data.free_access,
        custom_monthly_fee=data.custom_monthly_fee,
        clear_custom_hours=data.clear_custom_hours,
        clear_custom_fee=data.clear_custom_fee,
    )
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.put("/admin/users/{username}/profile")
async def update_user_profile(
    username: str,
    data: UpdateUserProfileRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    auth_manager = AuthManager(conn)
    user = await auth_manager.get_user_row(username)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다.")
    if user["role"] == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="관리자 계정은 수정할 수 없습니다.")
    is_success, message = await auth_manager.update_profile(username, name=data.name, phone=data.phone)
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/users/{username}/reset-password")
async def reset_user_password(
    username: str,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    auth_manager = AuthManager(conn)
    is_success, result = await auth_manager.reset_password(username)
    if is_success:
        return {
            "status": "success",
            "message": "임시 비밀번호를 발급했습니다. 이 화면을 닫으면 다시 볼 수 없어요.",
            "temp_password": result,
        }
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result)


@app.get("/admin/users/{username}/delete-preview")
async def get_user_delete_preview(
    username: str,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    preview = await AuthManager(conn).get_delete_preview(username)
    if preview is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="삭제할 수 있는 회원이 아닙니다.")
    return preview


@app.delete("/admin/users/{username}")
async def delete_user(
    username: str,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    is_success, message = await AuthManager(conn).delete_user(username)
    if is_success:
        await broadcast_reservation_updates(conn)
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


# ---------------------------------------------------------------- 토큰 (회원)
async def _require_token_charge_open(conn: aiosqlite.Connection, user: dict) -> None:
    """회원에게 토큰 메뉴가 공개되기 전에는 관리자만 쓸 수 있다 (미리보기).

    토큰 예약으로 전환된 뒤에는 충전이 항상 열려 있다.
    """
    if user["role"] == "admin":
        return
    settings = await SettingsManager(conn).get_settings()
    if settings.get("token_charge_enabled") != "true" and settings.get("reservation_mode") not in (MODE_TOKEN, MODE_BETA):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="아직 토큰 충전을 사용할 수 없습니다.")


@app.get("/tokens/packs")
async def list_token_packs(
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_charge_open(conn, current_user)
    packs = await TokenManager(conn).list_packs(active_only=True)
    is_free_member = current_user["role"] in ("free", "admin")
    return [
        p for p in packs
        if (is_free_member or p["audience"] != "free") and not is_expired(p["expires_on"])
    ]


@app.get("/tokens/me")
async def get_my_tokens(
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_charge_open(conn, current_user)
    tokens = TokenManager(conn)
    username = current_user["username"]
    return {
        "balance": await tokens.get_balance(username),
        "lots": await tokens.get_lots(username),
        "ledger": await tokens.list_ledger(username, limit=50),
        "purchases": await tokens.list_user_purchases(username, limit=20),
    }


@app.post("/tokens/purchases")
async def request_token_purchase(
    data: TokenPurchaseRequest,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_charge_open(conn, current_user)
    if current_user["role"] == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="관리자 계정은 토큰을 충전할 수 없습니다.")
    ok, message = await TokenManager(conn).request_purchase(current_user["username"], data.pack_id)
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/tokens/purchases/{purchase_id}/cancel")
async def cancel_my_token_purchase(
    purchase_id: int,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).cancel_own_purchase(current_user["username"], purchase_id)
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


# ---------------------------------------------------------------- 토큰 (관리자)
@app.get("/admin/token-settings")
async def get_token_settings(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    settings = await SettingsManager(conn).get_settings()
    return {"token_charge_enabled": settings.get("token_charge_enabled") == "true"}


@app.put("/admin/token-settings")
async def update_token_settings(
    data: TokenSettingsRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await SettingsManager(conn).upsert_settings(
        {"token_charge_enabled": "true" if data.token_charge_enabled else "false"}
    )
    if ok:
        return {"status": "success", "message": "토큰 충전 공개 설정을 저장했습니다."}
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=message)


@app.get("/admin/token-packs")
async def admin_list_token_packs(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    return await TokenManager(conn).list_packs(active_only=False)


@app.post("/admin/token-packs")
async def admin_create_token_pack(
    data: TokenPackCreate,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).create_pack(
        data.name, data.price_won, data.tokens,
        auto_confirm=data.auto_confirm, expires_on=data.expires_on, audience=data.audience,
    )
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.put("/admin/token-packs/{pack_id}")
async def admin_update_token_pack(
    pack_id: int,
    data: TokenPackUpdate,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).update_pack(
        pack_id,
        name=data.name,
        price_won=data.price_won,
        tokens=data.tokens,
        sort_order=data.sort_order,
        active=data.active,
        auto_confirm=data.auto_confirm,
        expires_on=data.expires_on,
        clear_expires_on=data.clear_expires_on,
        audience=data.audience,
    )
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.delete("/admin/token-packs/{pack_id}")
async def admin_delete_token_pack(
    pack_id: int,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).delete_pack(pack_id)
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/admin/token-purchases")
async def admin_list_token_purchases(
    status_filter: Optional[str] = None,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    if status_filter not in (None, "pending", "confirmed", "cancelled"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="status_filter가 올바르지 않습니다.")
    return await TokenManager(conn).list_purchases(status_filter)


@app.post("/admin/token-purchases/{purchase_id}/confirm")
async def admin_confirm_token_purchase(
    purchase_id: int,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).confirm_purchase(purchase_id, admin_user["username"])
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/token-purchases/{purchase_id}/reject")
async def admin_reject_token_purchase(
    purchase_id: int,
    data: RejectPurchaseRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).reject_purchase(purchase_id, data.memo)
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/token-purchases/{purchase_id}/undo")
async def admin_undo_token_purchase(
    purchase_id: int,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).undo_confirm_purchase(purchase_id, admin_user["username"])
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.get("/admin/token-balances")
async def admin_token_balances(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    return await TokenManager(conn).list_balances()


@app.get("/admin/token-ledger/{username}")
async def admin_token_ledger(
    username: str,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    tokens = TokenManager(conn)
    return {
        "balance": await tokens.get_balance(username),
        "lots": await tokens.get_lots(username),
        "ledger": await tokens.list_ledger(username, limit=200),
    }


@app.post("/admin/tokens/adjust")
async def admin_adjust_tokens(
    data: TokenAdjustRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).adjust(
        data.username, data.tokens, data.memo, admin_user["username"], data.expires_on
    )
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/tokens/grant")
async def admin_grant_tokens(
    data: TokenGrantRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    ok, message = await TokenManager(conn).grant_many(
        data.usernames, data.tokens, data.memo, admin_user["username"], data.expires_on
    )
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


# ---------------------------------------------------------------- 토큰 예약 (회원)
def _booking_error(e: BookingError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _parse_date(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)")


@app.get("/token-rules")
async def get_token_rules(conn: aiosqlite.Connection = Depends(get_db_conn)):
    """토큰 가격표·환불·소멸 규칙. 랜딩·가입 안내가 관리자 설정과 어긋나지 않게 공개한다."""
    return await BookingManager(conn).public_rules()


@app.get("/bookings/config")
async def get_booking_config(
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    return await BookingManager(conn).get_config(current_user["username"], current_user["role"])


@app.get("/bookings/calendar")
async def get_booking_calendar(
    month: str,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_mode(conn, current_user)
    try:
        year, mon = (int(x) for x in month.split("-"))
        date(year, mon, 1)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month 형식이 올바르지 않습니다. (YYYY-MM)")
    days = await BookingManager(conn).month_summary(current_user["username"], current_user["role"], year, mon)
    return {"month": month, "days": days}


@app.get("/bookings/range")
async def get_booking_range(
    start: str,
    days: int = 7,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_mode(conn, current_user)
    try:
        grid = await BookingManager(conn).range_grid(current_user["username"], current_user["role"], _parse_date(start), days)
    except BookingError as e:
        raise _booking_error(e)
    return {"days": grid}


@app.get("/bookings/mine")
async def get_my_bookings(
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_mode(conn, current_user)
    return await BookingManager(conn).my_bookings(current_user["username"])


@app.post("/bookings")
async def create_booking(
    data: BookingCreateRequest,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_mode(conn, current_user)
    try:
        result = await BookingManager(conn).create_bookings(
            current_user["username"], current_user["role"], [slot.model_dump() for slot in data.slots]
        )
    except BookingError as e:
        raise _booking_error(e)
    await broadcast_booking_update(result["dates"])
    spent = f" (토큰 {result['spent']} 사용)" if result["spent"] else ""
    return {"status": "success", "message": f"{result['count']}시간을 예약했어요.{spent}", **result}


@app.post("/bookings/cancel")
async def cancel_booking(
    data: BookingCancelRequest,
    current_user: dict = Depends(get_current_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await _require_token_mode(conn, current_user)
    try:
        result = await BookingManager(conn).cancel_bookings(data.ids, username=current_user["username"])
    except BookingError as e:
        raise _booking_error(e)
    await broadcast_booking_update(result["dates"])
    refunded = f" (토큰 {result['refunded']} 환불)" if result["refunded"] else ""
    return {"status": "success", "message": f"{result['count']}시간 예약을 취소했어요.{refunded}", **result}


# ---------------------------------------------------------------- 토큰 예약 (관리자)
@app.get("/admin/booking-settings")
async def get_booking_settings(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    config = await BookingManager(conn).get_config(admin_user["username"], "admin")
    return {
        "reservation_mode": config["mode"],
        "beta_month": config["beta_month"],
        # 베타 달이 끝나며 다음 달 예약이 열리는 시각 (11월 한정 토큰의 사용 기한으로 쓴다)
        "beta_month_open_at": (
            lambda at: at.isoformat() if at else None
        )(BookingManager.month_open_at(await SettingsManager(conn).get_settings(), config["beta_month"])),
        "next_month_open_at": config["next_month_open_at"],
        "price_bands": config["price_bands"],
        "refund_tiers": config["refund_tiers"],
    }


@app.put("/admin/booking-settings")
async def update_booking_settings(
    data: BookingSettingsRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    manager = BookingManager(conn)
    results = []
    if data.price_bands is not None:
        results.append(await manager.set_price_bands([b.model_dump() for b in data.price_bands]))
    if data.refund_tiers is not None:
        results.append(await manager.set_refund_tiers([t.model_dump() for t in data.refund_tiers]))
    if data.reservation_mode is not None:
        results.append(await manager.set_mode(data.reservation_mode, data.beta_month))
    elif data.beta_month is not None:
        results.append(await manager.set_mode(await manager.get_mode(), data.beta_month))
    if not results:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="변경할 항목이 없습니다.")
    for ok, message in results:
        if not ok:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    await broadcast_reservation_updates(conn)
    return {"status": "success", "message": "예약 설정을 저장했습니다."}


@app.get("/admin/bookings")
async def admin_list_bookings(
    date_filter: Optional[str] = None,
    username: Optional[str] = None,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    day = _parse_date(date_filter) if date_filter else None
    return await BookingManager(conn).admin_list(day, username)


@app.post("/admin/bookings")
async def admin_create_booking(
    data: AdminBookingCreateRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    """관리자 강제 예약: 범위·권한·토큰을 따지지 않고 해당 회원 이름으로 등록한다."""
    try:
        result = await BookingManager(conn).create_bookings(
            data.username, "user", [slot.model_dump() for slot in data.slots], force_by=admin_user["username"]
        )
    except BookingError as e:
        raise _booking_error(e)
    await broadcast_booking_update(result["dates"])
    return {"status": "success", "message": f"{result['count']}시간을 등록했어요.", **result}


@app.post("/admin/bookings/{booking_id}/cancel")
async def admin_cancel_booking(
    booking_id: int,
    data: AdminBookingCancelRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    try:
        result = await BookingManager(conn).cancel_bookings(
            [booking_id], admin_username=admin_user["username"], refund_override=data.refund
        )
    except BookingError as e:
        raise _booking_error(e)
    await broadcast_booking_update(result["dates"])
    return {"status": "success", "message": "예약을 취소했어요.", **result}


@app.put("/admin/users/{username}/dawn")
async def set_dawn_permission(
    username: str,
    data: DawnPermissionRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    async with conn.execute("SELECT role FROM users WHERE username = ?", (username,)) as cursor:
        row = await cursor.fetchone()
    if not row or row["role"] == "admin":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다.")
    await conn.execute("UPDATE users SET dawn_allowed = ? WHERE username = ?", (1 if data.allowed else 0, username))
    await conn.commit()
    return {"status": "success", "message": "새벽 예약 권한을 저장했습니다."}


@app.get("/admin/roster")
async def get_roster(
    period: Optional[str] = None,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    target = period or period_from_offset(1)
    roster = await membership.get_roster(target)
    return {
        **roster,
        "suggested_next_period": period_from_offset(1),
        "usage_period": usage_period(),
    }


@app.post("/admin/roster/add")
async def roster_add(
    data: RosterAddRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    ok, message = await membership.add_to_roster(
        data.username,
        data.period,
        data.plan_id,
        allowed_hours=data.allowed_hours,
        custom_monthly_fee=data.custom_monthly_fee,
        free_access=data.free_access,
    )
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/roster/remove")
async def roster_remove(
    data: RosterRemoveRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    ok, message = await membership.remove_from_roster(data.username, data.period)
    if ok:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.post("/admin/billing/generate")
async def generate_billing(
    data: BillingPeriodRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    period = data.period or period_from_offset(1)
    ok, message = await membership.generate_billing(period)
    if ok:
        return {"status": "success", "message": message, "period": period}
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


@app.post("/admin/billing/unconfirm")
async def unconfirm_billing_payment(
    data: UnconfirmPaymentRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    if data.billing_id is not None:
        is_success, message = await membership.undo_confirm_payment(data.billing_id)
    elif data.period:
        is_success, message = await membership.undo_all_confirmations_for_period(data.period)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="billing_id 또는 period를 지정해주세요.",
        )
    if is_success:
        return {"status": "success", "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@app.put("/admin/settings/access-period")
async def set_access_period_setting(
    data: SetAccessPeriodRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    membership = MembershipManager(conn)
    is_success, message = await membership.admin_set_access_period(data.period)
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
        "payment_guide": settings.get("payment_guide"),
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


@app.put("/admin/settings/payment-guide")
async def update_payment_guide(
    data: UpdatePaymentGuideRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    settings_manager = SettingsManager(conn)
    text = data.payment_guide.strip()
    is_success, message = await settings_manager.upsert_settings({"payment_guide": text or None})
    if is_success:
        return {"status": "success", "message": "입금 안내 문구가 저장되었습니다."}
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
    if data.reservation_opens_at is not None:
        payload["reservation_opens_at"] = data.reservation_opens_at
        if not data.auto_monthly_open_enabled:
            payload["last_cleared_for"] = None
    elif data.auto_monthly_open_enabled or data.clear_reservation_opens_at:
        payload["reservation_opens_at"] = None

    is_success, message = await settings_manager.upsert_settings(payload)
    if not is_success:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=message)
    reserve_manager = ReservationManager(conn)
    _, _, did_clear = await reserve_manager.check_reservation_availability()
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
    if data.reservation_type == "monthly":
        conflicts = await BookingManager(conn).monthly_conflicts(reserve_times_list)
        if conflicts:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"이미 토큰으로 예약된 시간이 있어요: {', '.join(conflicts[:3])}",
            )
    is_success, message = await reserve_manager.force_create_reservation(
        data.target_username,
        reserve_times_list,
        reservation_type=data.reservation_type,
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


@app.post("/admin/reservations/clear")
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


@app.get("/admin/free/schedule")
async def admin_get_free_schedule(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    free = await reserve_manager.get_reservations(RESERVATION_FREE)
    monthly = await reserve_manager.get_reservations(RESERVATION_MONTHLY)
    meta = await reserve_manager.get_free_schedule_meta()
    usage = await reserve_manager.get_weekly_usage(RESERVATION_FREE)
    return {
        "free_reservations": free,
        "monthly_reservations": monthly,
        "weekly_usage": usage,
        **meta,
    }


@app.post("/admin/reservations/clear-free")
async def admin_clear_free_reservations(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    reserve_manager = ReservationManager(conn)
    is_success, message = await reserve_manager.clear_free_reservations()
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
    # 예약 현황에는 회원 이름이 들어 있으므로 로그인한 회원에게만, 같은 출처의 페이지에만 연결을 허용한다.
    origin = websocket.headers.get("origin")
    if origin and origin.split("://", 1)[-1] != websocket.headers.get("host", "") and origin not in _cors_origins:
        await websocket.close(code=1008)
        return
    try:
        await _user_from_token(websocket.cookies.get(SESSION_COOKIE), conn, "/ws")
    except HTTPException:
        await websocket.close(code=1008)
        return
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

# 홈 화면에 추가했을 때 쓰는 앱 아이콘 (frontend/public/icons/)
if os.path.isdir("static/dist/icons"):
    app.mount("/icons", StaticFiles(directory="static/dist/icons"), name="icons")

# 랜딩 페이지 사진 (frontend/public/landing/ 에 넣은 파일)
if os.path.isdir("static/dist/landing"):
    app.mount("/landing", StaticFiles(directory="static/dist/landing"), name="landing")


@app.get("/healthz")
async def healthz(conn: aiosqlite.Connection = Depends(get_db_conn)):
    """배포 상태 점검용: 앱이 떠 있고 DB가 응답하면 200."""
    async with conn.execute("SELECT 1") as cursor:
        await cursor.fetchone()
    return {"status": "ok"}


@app.get("/")
async def read_index():
    return _spa_index()


@app.get("/admin")
async def read_admin_index():
    return _spa_index()


@app.get("/free")
async def read_free_index():
    return _spa_index()


@app.get("/register")
async def read_register_index():
    return _spa_index()


@app.get("/tokens")
async def read_tokens_index():
    return _spa_index()


@app.get("/book")
async def read_book_index():
    return _spa_index()


@app.get("/login")
async def read_login_index():
    return _spa_index()


@app.get("/about")
async def read_about_index():
    return _spa_index()


@app.get("/notices")
async def read_notices_index():
    return _spa_index()


@app.get("/notices/{notice_id}")
async def read_notice_index(notice_id: str):
    return _spa_index()


@app.get("/manifest.webmanifest")
async def web_manifest():
    path = "static/dist/manifest.webmanifest"
    if os.path.exists(path):
        return FileResponse(path, media_type="application/manifest+json")
    raise HTTPException(status_code=404)


@app.get("/sw.js")
async def service_worker():
    # 서비스 워커는 사이트 전체(/)를 범위로 삼아야 하고, 갱신이 바로 반영되도록 캐시하지 않는다.
    path = "static/dist/sw.js"
    if os.path.exists(path):
        return FileResponse(
            path,
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache"},
        )
    raise HTTPException(status_code=404)


@app.get("/favicon.svg")
async def favicon_svg():
    path = "static/dist/favicon.svg"
    if os.path.exists(path):
        return FileResponse(path, media_type="image/svg+xml")
    raise HTTPException(status_code=404)


# ---------------------------------------------------------------- 공지·이용 안내
def _notice_error(e: NoticeError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@app.get("/api/notices")
async def list_notices(
    category: Optional[str] = None,
    user: Optional[dict] = Depends(get_optional_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    return await NoticeManager(conn).list(members=user is not None, category=category)


@app.get("/api/notices/{notice_id}")
async def get_notice(
    notice_id: int,
    user: Optional[dict] = Depends(get_optional_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    notice = await NoticeManager(conn).get(notice_id, members=user is not None)
    if not notice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="공지를 찾을 수 없습니다.")
    return notice


@app.get("/admin/notices")
async def admin_list_notices(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    return await NoticeManager(conn).list(include_drafts=True, members=True)


@app.get("/admin/notices/{notice_id}")
async def admin_get_notice(
    notice_id: int,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    notice = await NoticeManager(conn).get(notice_id, include_drafts=True, members=True)
    if not notice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="공지를 찾을 수 없습니다.")
    return notice


@app.post("/admin/notices")
async def admin_create_notice(
    data: NoticeCreateRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    try:
        return await NoticeManager(conn).create(**data.model_dump(), created_by=admin_user["username"])
    except NoticeError as e:
        raise _notice_error(e)


@app.put("/admin/notices/{notice_id}")
async def admin_update_notice(
    notice_id: int,
    data: NoticeUpdateRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    try:
        return await NoticeManager(conn).update(notice_id, data.model_dump())
    except NoticeError as e:
        raise _notice_error(e)


@app.delete("/admin/notices/{notice_id}")
async def admin_delete_notice(
    notice_id: int,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    try:
        await NoticeManager(conn).delete(notice_id)
    except NoticeError as e:
        raise _notice_error(e)
    return {"status": "success", "message": "공지를 삭제했습니다."}


@app.get("/admin/notice-api-key")
async def admin_notice_key_status(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    return await NoticeManager(conn).key_status()


@app.post("/admin/notice-api-key")
async def admin_rotate_notice_key(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    """에이전트용 키를 새로 만든다 (이전 키는 즉시 못 쓴다). 키는 이 응답에서만 볼 수 있다."""
    return {"api_key": await NoticeManager(conn).rotate_key()}


@app.delete("/admin/notice-api-key")
async def admin_revoke_notice_key(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    await NoticeManager(conn).revoke_key()
    return {"status": "success", "message": "에이전트 키를 폐기했습니다."}


# 에이전트 전용: 공지 작성 권한만 가진 API 키 (Authorization: Bearer ntc_...). 쿠키 로그인은 받지 않는다.
async def require_notice_agent(request: Request, conn: aiosqlite.Connection = Depends(get_db_conn)) -> str:
    header = request.headers.get("authorization", "")
    key = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not await NoticeManager(conn).verify_key(key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 API 키입니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return "agent"


@app.get("/api/agent/notices")
async def agent_list_notices(_: str = Depends(require_notice_agent), conn: aiosqlite.Connection = Depends(get_db_conn)):
    return await NoticeManager(conn).list(include_drafts=True, members=True)


@app.get("/api/agent/notices/{notice_id}")
async def agent_get_notice(
    notice_id: int, _: str = Depends(require_notice_agent), conn: aiosqlite.Connection = Depends(get_db_conn)
):
    notice = await NoticeManager(conn).get(notice_id, include_drafts=True, members=True)
    if not notice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="공지를 찾을 수 없습니다.")
    return notice


@app.post("/api/agent/notices")
async def agent_create_notice(
    data: NoticeCreateRequest, _: str = Depends(require_notice_agent), conn: aiosqlite.Connection = Depends(get_db_conn)
):
    """published를 생략하면 초안으로 저장되고, 관리자가 검토한 뒤 공개한다."""
    try:
        return await NoticeManager(conn).create(**data.model_dump(), created_by="agent")
    except NoticeError as e:
        raise _notice_error(e)


@app.put("/api/agent/notices/{notice_id}")
async def agent_update_notice(
    notice_id: int,
    data: NoticeUpdateRequest,
    _: str = Depends(require_notice_agent),
    conn: aiosqlite.Connection = Depends(get_db_conn),
):
    try:
        return await NoticeManager(conn).update(notice_id, data.model_dump())
    except NoticeError as e:
        raise _notice_error(e)


@app.delete("/api/agent/notices/{notice_id}")
async def agent_delete_notice(
    notice_id: int, _: str = Depends(require_notice_agent), conn: aiosqlite.Connection = Depends(get_db_conn)
):
    try:
        await NoticeManager(conn).delete(notice_id)
    except NoticeError as e:
        raise _notice_error(e)
    return {"status": "success", "message": "공지를 삭제했습니다."}
