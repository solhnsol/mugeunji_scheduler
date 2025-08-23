from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from jose import jwt
from datetime import datetime, timedelta, timezone
import os
from typing import List, Literal
from contextlib import asynccontextmanager

from src.auth import AuthManager
from src.database import get_db_connection, setup_database
from src.reservation import ReservationManager


SECRET_KEY = os.getenv("SECRET_KEY", "mugeunjistudio")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = await get_db_connection()
    await setup_database(conn)
    app.state.auth_manager = AuthManager(conn)
    app.state.reserve_manager = ReservationManager(conn)
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

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    reserve_manager: ReservationManager = websocket.app.state.reserve_manager
    await connection_manager.connect(websocket)
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
            detail="사용자 이름이나 비밀번호가 틀렸습니다.",
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

@app.post('/admin/login')
async def admin_login_for_access_token(request: Request, login_info: LoginInfo):
    auth_manager: AuthManager = request.app.state.auth_manager
    user_data = await auth_manager.admin_login(login_info.username, login_info.password)
    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디/비밀번호가 틀렸거나 관리자 권한이 없습니다.",
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

@app.get('/admin')
async def read_admin_index():
    return FileResponse("./static/admin/admin.html")

@app.get('/test')
async def test(request: Request):
    auth_manager: AuthManager = request.app.state.auth_manager
    reserve_manager: ReservationManager = request.app.state.reserve_manager
    await auth_manager.update_users(
        [
            {'username':'정한솔', 'password':'0000', 'allowed_hours': 8, 'role': 'admin'},
            {'username':'허영은', 'password':'0000', 'allowed_hours': 8, 'role': 'admin'},
        ]
    )
    await reserve_manager.clear_reservations()

    return RedirectResponse(url='/')

