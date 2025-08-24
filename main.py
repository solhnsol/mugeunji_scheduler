from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request, UploadFile, File
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from jose import jwt
from datetime import datetime, timedelta, timezone
import os, csv, io
from typing import List, Literal, Optional
from contextlib import asynccontextmanager
from jose import JWTError
import pandas as pd

from src.auth import AuthManager
from src.database import get_db_connection, setup_database
from src.reservation import ReservationManager
from src.settings import SettingsManager


SECRET_KEY = os.getenv("SECRET_KEY", "mugeunjistudio")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = await get_db_connection()
    await setup_database(conn)
    app.state.auth_manager = AuthManager(conn)
    app.state.reserve_manager = ReservationManager(conn)
    app.state.settings_manager = SettingsManager(conn)
    yield
    await conn.close()

class LoginInfo(BaseModel):
    username: str
    password: str

ValidDay = Literal["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

class ReservationItem(BaseModel):
    day: ValidDay
    time_index: int = Field(..., ge=0, le=23)
class ReservationList(BaseModel):
    reservations: List[ReservationItem]

class AdminReservationRequest(BaseModel):
    target_username: str = Field(..., min_length=1)
    reservations: List[ReservationItem]

class UserInfoResponse(BaseModel):
    username: str
    allowed_hours: int
    role: str

class SettingsResponse(BaseModel):
    reservation_enabled: bool
    reservation_opens_at: Optional[datetime] = None

class UpdateSettingsRequest(BaseModel):
    reservation_enabled: bool
    reservation_opens_at: Optional[str] = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
    async def broadcast_json(self, data: dict):
        for connection in self.active_connections:
            await connection.send_json(data)

app = FastAPI(lifespan=lifespan)
app.mount("/static/general", StaticFiles(directory="static/general"), name="general")
app.mount("/static/admin", StaticFiles(directory="static/admin"), name="admin")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
connection_manager = ConnectionManager()

def create_access_token(data: dict):
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = data.copy()
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_admin_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="권한이 없습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None or role != "admin":
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return {"username": username, "role": role}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    reserve_manager: ReservationManager = websocket.app.state.reserve_manager
    await connection_manager.connect(websocket)
    await reserve_manager.check_reservation_availability()
    try:
        reservations = await reserve_manager.get_all_reservations()
        await websocket.send_json({
            "type": "RESERVATION_UPDATE",
            "data": reservations
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connection_manager.disconnect(websocket)

@app.post('/login')
async def login_for_access_token(request: Request, login_info: LoginInfo):
    auth_manager: AuthManager = request.app.state.auth_manager
    user_data = await auth_manager.login(login_info.username, login_info.password)
    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자 이름/비밀번호가 틀렸습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_data = {
        "sub": user_data['username'],
        "role": user_data['role']
    }
    access_token = create_access_token(data=access_token_data)
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "allowed_hours": user_data['allowed_hours']
    }

@app.post('/reserve')
async def reserve_time(
    request: Request,
    data: ReservationList,
    token: str = Depends(oauth2_scheme)
):
    reserve_manager: ReservationManager = request.app.state.reserve_manager
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    username = payload.get("sub")
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    is_success, message = await reserve_manager.create_reservation(username, reserve_times_list)
    if is_success:
        all_reservations = await reserve_manager.get_all_reservations()

        await connection_manager.broadcast_json({
            "type": "RESERVATION_UPDATE",
            "data": all_reservations
        })

        return {
        "status": "success",
        "message": str(message),
    }
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

@app.get('/')
async def read_index():
    return FileResponse("./static/general/index.html")

@app.get("/settings", response_model=SettingsResponse)
async def get_public_settings(request: Request):
    """일반 사용자가 예약 관련 설정을 조회하는 엔드포인트"""
    settings_manager: SettingsManager = request.app.state.settings_manager
    settings = await settings_manager.get_settings()
    
    opens_at = settings.get('reservation_opens_at')
    
    return {
        "reservation_enabled": settings.get('reservation_enabled') == 'true',
        "reservation_opens_at": datetime.fromisoformat(opens_at) if opens_at else None
    }

@app.post('/admin/login')
async def admin_login_for_access_token(request: Request, login_info: LoginInfo):
    auth_manager: AuthManager = request.app.state.auth_manager
    user_data = await auth_manager.admin_login(login_info.username, login_info.password)
    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자 이름/비밀번호가 틀렸거나 관리자 권한이 없습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_data = {
        "sub": user_data['username'],
        "role": user_data['role']
    }
    access_token = create_access_token(data=access_token_data)
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
    }

@app.post('/admin/reservations/create')
async def create_reservations_by_admin(
    request: Request,
    data: AdminReservationRequest,
    admin_user: dict = Depends(get_current_admin_user)
):
    reserve_manager: ReservationManager = request.app.state.reserve_manager
    target_username = data.target_username
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    
    is_success, message = await reserve_manager.force_create_reservation(
        target_username, reserve_times_list
    )
    
    if is_success:
        all_reservations = await reserve_manager.get_all_reservations()
        await connection_manager.broadcast_json({
            "type": "RESERVATION_UPDATE",
            "data": all_reservations
        })
        return {"status": "success", "message": message}
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

@app.post('/admin/reservations/delete')
async def delete_reservations_by_admin(
    request: Request,
    data: ReservationList,
    admin_user: dict = Depends(get_current_admin_user)
):
    reserve_manager: ReservationManager = request.app.state.reserve_manager
    reserve_times_list = [item.model_dump(mode="python") for item in data.reservations]
    
    is_success, message = await reserve_manager.delete_reservations(reserve_times_list)
    
    if is_success:
        all_reservations = await reserve_manager.get_all_reservations()
        await connection_manager.broadcast_json({
            "type": "RESERVATION_UPDATE",
            "data": all_reservations
        })
        return {"status": "success", "message": message}
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

@app.get("/admin/reservations/clear")
async def clear_reservations_by_admin(
    request: Request,
    admin_user: dict = Depends(get_current_admin_user)
):
    reserve_manager: ReservationManager = request.app.state.reserve_manager
    is_success, message = await reserve_manager.clear_reservations()

    if is_success:
        all_reservations = await reserve_manager.get_all_reservations()
        await connection_manager.broadcast_json({
            "type": "RESERVATION_UPDATE",
            "data": all_reservations
        })
        return {"status": "success", "message": message}
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

@app.post("/admin/users/upload-csv")
async def upload_users_csv(
    request: Request,
    file: UploadFile = File(...),
    admin_user: dict = Depends(get_current_admin_user)
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV 파일만 업로드할 수 있습니다."
        )

    auth_manager: AuthManager = request.app.state.auth_manager
    new_users = []

    try:
        df = pd.read_csv(file.file, dtype={'password': str})

        for i, row in df.iterrows():
            user_data = {
                'username': row['username'],
                'password': row['password'],
                'allowed_hours': int(row['allowed_hours']),
                'role': row['role']
            }
            new_users.append(user_data)

    except (KeyError, ValueError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CSV 파일의 형식이 잘못되었습니다. 필수 컬럼(username, password, allowed_hours, role)을 확인하거나 데이터 타입을 확인해주세요. 오류: {e}"
        )
    except Exception as e:
         raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"파일 처리 중 오류 발생: {file}"
        )

    if not new_users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV 파일에 데이터가 없습니다."
        )
    is_success, message = await auth_manager.update_users(new_users)

    if is_success:
        return {"status": "success", "message": message}
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=message
        )

@app.get("/admin/users", response_model=List[UserInfoResponse])
async def get_all_users_by_admin(
    request: Request,
    admin_user: dict = Depends(get_current_admin_user)
):
    auth_manager: AuthManager = request.app.state.auth_manager
    users = await auth_manager.get_all_users()
    return users

@app.get("/admin/settings", response_model=SettingsResponse)
async def get_settings_by_admin(
    request: Request,
    admin_user: dict = Depends(get_current_admin_user)
):
    settings_manager: SettingsManager = request.app.state.settings_manager
    settings = await settings_manager.get_settings()
    
    opens_at = settings.get('reservation_opens_at')
    
    return {
        "reservation_enabled": settings.get('reservation_enabled') == 'true',
        "reservation_opens_at": datetime.fromisoformat(opens_at) if opens_at else None
    }

@app.put("/admin/settings")
async def update_settings_by_admin(
    request: Request,
    data: UpdateSettingsRequest,
    admin_user: dict = Depends(get_current_admin_user)
):
    settings_manager: SettingsManager = request.app.state.settings_manager

    new_settings = {
        "reservation_enabled": str(data.reservation_enabled).lower(),
        "reservation_opens_at": data.reservation_opens_at
    }

    is_success, message = await settings_manager.update_settings(new_settings)

    if is_success:
        return {"status": "success", "message": message}
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=message
        )

@app.get('/admin')
async def read_admin_index():
    return FileResponse("./static/admin/admin.html")
