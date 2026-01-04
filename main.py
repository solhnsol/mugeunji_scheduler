from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request, UploadFile, File
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from jose import jwt, JWTError
from datetime import datetime, timedelta, timezone
import os
import pandas as pd
from typing import List, Literal, Optional, AsyncGenerator
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import aiosqlite
import io

from src.auth import AuthManager
from src.database import init_db
from src.reservation import ReservationManager
from src.settings import SettingsManager

SECRET_KEY = os.getenv("SECRET_KEY", "mugeunjistudio")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 앱 시작 시 DB 연결
    db_conn = await init_db()
    app.state.db_conn = db_conn
    yield
    # 앱 종료 시 DB 연결 해제
    await app.state.db_conn.close()

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

async def get_db_conn(request: Request) -> aiosqlite.Connection:
    # state에 저장된 연결 객체를 반환
    return request.app.state.db_conn

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    conn = websocket.app.state.db_conn
    reserve_manager = ReservationManager(conn)
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
async def login_for_access_token(
    login_info: LoginInfo,
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    auth_manager = AuthManager(conn)
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
    data: ReservationList,
    token: str = Depends(oauth2_scheme),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    reserve_manager = ReservationManager(conn)
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
async def get_public_settings(
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    settings_manager = SettingsManager(conn)
    settings = await settings_manager.get_settings()
    
    opens_at = settings.get('reservation_opens_at')
    
    return {
        "reservation_enabled": settings.get('reservation_enabled') == 'true',
        "reservation_opens_at": datetime.fromisoformat(opens_at) if opens_at else None
    }

@app.post('/admin/login')
async def admin_login_for_access_token(
    login_info: LoginInfo,
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    auth_manager = AuthManager(conn)
    user_data = await auth_manager.admin_login(login_info.username, login_info.password)
    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='''로그인 정보가 틀렸거나
            관리자 권한이 없습니다.''',
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
    data: AdminReservationRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    reserve_manager = ReservationManager(conn)
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
    data: ReservationList,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    reserve_manager = ReservationManager(conn)
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
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    reserve_manager = ReservationManager(conn)
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
    file: UploadFile = File(...),
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV 파일만 업로드할 수 있습니다."
        )

    auth_manager = AuthManager(conn)
    new_users = []

    try:
        # [수정된 부분 시작] ------------------------------------------------
        # 1. 파일의 내용을 비동기로 모두 읽습니다 (byte 상태)
        contents = await file.read()
        
        # 2. 바이트를 문자열로 디코딩합니다 (utf-8 가정)
        # 한글이 깨진다면 'euc-kr'이나 'cp949'를 시도해 볼 수 있습니다.
        decoded_contents = contents.decode('utf-8')
        
        # 3. 문자열을 파일처럼 취급하기 위해 StringIO 객체로 변환합니다.
        csv_buffer = io.StringIO(decoded_contents)
        
        # 4. Pandas는 이제 실제 파일이 아닌 메모리 상의 버퍼를 읽습니다.
        df = pd.read_csv(csv_buffer, dtype={'password': str})
        # [수정된 부분 끝] --------------------------------------------------

        for i, row in df.iterrows():
            # 데이터 유효성 검사 (컬럼 존재 여부 등)를 간단히 추가하면 더 안전합니다.
            if not all(k in row for k in ['username', 'password', 'allowed_hours', 'role']):
                 raise ValueError("필수 컬럼(username, password, allowed_hours, role)이 누락되었습니다.")

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
         # 디코딩 실패 등의 오류도 여기서 잡힙니다.
         raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"파일 처리 중 오류 발생: {str(e)}"
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
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    auth_manager = AuthManager(conn)
    users = await auth_manager.get_all_users()
    return users

@app.get("/admin/settings", response_model=SettingsResponse)
async def get_settings_by_admin(
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    settings_manager = SettingsManager(conn)
    settings = await settings_manager.get_settings()
    opens_at = settings.get('reservation_opens_at')
    return {
        "reservation_enabled": settings.get('reservation_enabled') == 'true',
        "reservation_opens_at": datetime.fromisoformat(opens_at) if opens_at else None
    }

@app.put("/admin/settings")
async def update_settings_by_admin(
    data: UpdateSettingsRequest,
    admin_user: dict = Depends(get_current_admin_user),
    conn: aiosqlite.Connection = Depends(get_db_conn)
):
    settings_manager = SettingsManager(conn)
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