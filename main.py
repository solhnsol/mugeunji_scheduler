from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
from typing import List, Dict
import json
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from source.login import AuthManager

# --- 스케줄러 라이브러리 import ---
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.base import JobLookupError

# --- 기본 설정 ---
SECRET_KEY = os.getenv("SECRET_KEY", "mugeunjistudio")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
RESERVATIONS_FILE = "data/reservations.json"
SCHEDULER_FILE = "data/scheduler_config.json" # 스케줄러 설정 저장 파일

# --- 스케줄러 및 상태 변수 초기화 ---
scheduler = AsyncIOScheduler()
all_reservations: List['Reservation'] = []
reservations_lock = asyncio.Lock()
RESERVATION_OPEN_DATETIME: datetime = datetime.now(timezone.utc) # 기본값

# --- 데이터 모델 클래스 ---
class LoginInfo(BaseModel):
    username: str; password: str
class Reservation(BaseModel):
    day: str; time_index: int; username: str
class ReservationRequest(BaseModel):
    day: str; time_index: int
class AdminReservationRequest(BaseModel):
    day: str; time_index: int; username: str
class ScheduleRequest(BaseModel):
    open_datetime_str: str = Field(..., alias="open_datetime")

# --- ConnectionManager (변경 없음) ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        self.active_connections.pop(client_id, None)

    async def broadcast(self, data: dict):
        for connection in self.active_connections.values():
            await connection.send_json(data)
manager = ConnectionManager()

# --- 파일 읽기/쓰기 함수 ---
def read_reservations() -> List[Reservation]:
    os.makedirs(os.path.dirname(RESERVATIONS_FILE), exist_ok=True)
    if not os.path.exists(RESERVATIONS_FILE): return []
    try:
        with open(RESERVATIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [Reservation(**item) for item in data]
    except (json.JSONDecodeError, FileNotFoundError):
        return []

def write_reservations_to_file():
    with open(RESERVATIONS_FILE, "w", encoding="utf-8") as f:
        json_data = [res.model_dump() for res in all_reservations]
        json.dump(json_data, f, ensure_ascii=False, indent=4)

# --- 스케줄링 관련 함수 ---
async def reset_reservations_job():
    """예약 데이터를 모두 초기화하는 스케줄링 작업"""
    async with reservations_lock:
        all_reservations.clear()
        write_reservations_to_file()
    print(f"[{datetime.now()}] 스케줄에 따라 예약이 초기화되었습니다.")
    await manager.broadcast({"type": "RESERVATION_RESET"})

def save_schedule_config(open_dt: datetime):
    with open(SCHEDULER_FILE, "w", encoding="utf-8") as f:
        json.dump({"open_datetime": open_dt.isoformat()}, f)

def load_schedule_config():
    global RESERVATION_OPEN_DATETIME
    if os.path.exists(SCHEDULER_FILE):
        with open(SCHEDULER_FILE, "r", encoding="utf-8") as f:
            config = json.load(f)
            open_dt_str = config.get("open_datetime")
            if open_dt_str:
                RESERVATION_OPEN_DATETIME = datetime.fromisoformat(open_dt_str)
                # 서버 시작 시, 예약 시간이 미래라면 스케줄 다시 등록
                if RESERVATION_OPEN_DATETIME > datetime.now(timezone.utc):
                    reset_time = RESERVATION_OPEN_DATETIME - timedelta(hours=1)
                    scheduler.add_job(reset_reservations_job, 'date', run_date=reset_time, id='reservation_reset_job', replace_existing=True)
                    print(f"서버 시작: 예약 초기화가 {reset_time}으로 스케줄되었습니다.")

# --- FastAPI 앱 수명 주기 관리 (lifespan) ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global all_reservations
    all_reservations = read_reservations()
    load_schedule_config() # 스케줄러 설정 로드
    scheduler.start() # 스케줄러 시작
    yield
    scheduler.shutdown() # 앱 종료 시 스케줄러 종료

# --- FastAPI 앱 초기화 ---
app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
auth_manager = AuthManager(filepath="data/user_list.csv")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# --- JWT 및 인증 함수 ---
def create_access_token(data: dict):
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({**data, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)

credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role", "user") # role 정보 추가
        if username is None: raise credentials_exception
        return {"username": username, "role": role}
    except JWTError:
        raise credentials_exception

async def get_current_admin_user(current_user: dict = Depends(get_current_user)):
    """관리자인지 확인하는 의존성 함수"""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
    return current_user

# --- 라우팅 (API 엔드포인트) ---
@app.post('/login')
async def login_for_access_token(login_info: LoginInfo):
    user_data = auth_manager.login(login_info.username, login_info.password)
    if not user_data: 
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    
    access_token_data = {"sub": user_data['username'], "role": user_data['role']}
    access_token = create_access_token(data=access_token_data)
    
    return {"access_token": access_token, "token_type": "bearer", "allowed_hours": user_data['allowed_hours']}

# ... (기존 /reservations GET, POST 엔드포인트는 그대로 유지)
@app.get("/reservations", response_model=List[Reservation])
async def get_all_reservations_endpoint():
    return all_reservations

@app.post("/reservations", status_code=status.HTTP_201_CREATED)
async def create_reservations(reservations_req: List[ReservationRequest], current_user_data: dict = Depends(get_current_user)):
    current_user = current_user_data['username']
    if datetime.now(timezone.utc) < RESERVATION_OPEN_DATETIME.astimezone(timezone.utc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"예약은 {RESERVATION_OPEN_DATETIME.isoformat()} 부터 가능합니다.")
    
    # 이하 로직은 기존과 동일 (current_user 변수 사용 부분만 수정)
    newly_added_reservations = []
    async with reservations_lock:
        user_reservations_count = sum(1 for res in all_reservations if res.username == current_user)
        allowed_hours = auth_manager.get_allowed_hours(current_user)
        if user_reservations_count + len(reservations_req) > allowed_hours:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Exceeds your allowed limit of {allowed_hours} hours.")
        
        reserved_slots = {(res.day, res.time_index) for res in all_reservations}
        for req in reservations_req:
            if (req.day, req.time_index) in reserved_slots:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Slot {req.day} at index {req.time_index} is already reserved.")
            new_reservation = Reservation(day=req.day, time_index=req.time_index, username=current_user)
            newly_added_reservations.append(new_reservation)
        
        all_reservations.extend(newly_added_reservations)
        write_reservations_to_file()
    
    await manager.broadcast({"type": "RESERVATION_UPDATE", "data": [res.model_dump() for res in newly_added_reservations]})
    return {"message": "Reservations created successfully."}

# --- 관리자 기능 엔드포인트 ---
@app.post("/admin/reservation", status_code=status.HTTP_201_CREATED)
async def upsert_reservation_by_admin(req: AdminReservationRequest, admin: dict = Depends(get_current_admin_user)):
    """관리자가 예약을 추가하거나 수정합니다."""
    async with reservations_lock:
        existing_res = next((r for r in all_reservations if r.day == req.day and r.time_index == req.time_index), None)
        if existing_res:
            existing_res.username = req.username
        else:
            all_reservations.append(Reservation(**req.model_dump()))
        write_reservations_to_file()
    
    await manager.broadcast({"type": "RESERVATION_UPDATE", "data": [req.model_dump()]})
    return {"message": "Reservation updated successfully."}

@app.delete("/admin/reservation", status_code=status.HTTP_200_OK)
async def delete_reservation_by_admin(req: ReservationRequest, admin: dict = Depends(get_current_admin_user)):
    """관리자가 예약을 삭제합니다."""
    removed = False
    async with reservations_lock:
        initial_len = len(all_reservations)
        all_reservations[:] = [r for r in all_reservations if not (r.day == req.day and r.time_index == req.time_index)]
        if len(all_reservations) < initial_len:
            removed = True
            write_reservations_to_file()

    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found.")

    await manager.broadcast({"type": "RESERVATION_DELETE", "data": req.model_dump()})
    return {"message": "Reservation deleted successfully."}

@app.post("/admin/schedule", status_code=status.HTTP_200_OK)
async def schedule_reservation_reset(req: ScheduleRequest, admin: dict = Depends(get_current_admin_user)):
    """관리자가 예약 초기화 및 오픈 시간을 스케줄합니다."""
    global RESERVATION_OPEN_DATETIME
    try:
        open_datetime = datetime.fromisoformat(req.open_datetime_str)
        RESERVATION_OPEN_DATETIME = open_datetime
        
        reset_time = open_datetime - timedelta(hours=1)
        
        try:
            scheduler.remove_job('reservation_reset_job')
        except JobLookupError:
            pass # 잡이 없으면 그냥 통과
            
        scheduler.add_job(reset_reservations_job, 'date', run_date=reset_time, id='reservation_reset_job')
        save_schedule_config(open_datetime) # 설정 파일에 저장

        return {
            "message": "Reservation reset scheduled successfully.",
            "reset_time": reset_time.isoformat(),
            "open_time": open_datetime.isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid datetime format or error: {e}")

@app.get("/admin/schedule", status_code=status.HTTP_200_OK)
async def get_schedule_info(admin: dict = Depends(get_current_admin_user)):
    """현재 설정된 예약 오픈 시간을 가져옵니다."""
    return {"open_datetime": RESERVATION_OPEN_DATETIME.isoformat()}


# --- 웹소켓 및 정적 파일 서빙 ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = os.urandom(16).hex()
    await manager.connect(websocket, client_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(client_id)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def read_root():
    return FileResponse("static/index.html")

# --- 관리자 페이지 라우트 추가 ---
@app.get("/admin", response_class=HTMLResponse)
async def read_admin_page():
    return FileResponse("static/admin.html")

from fastapi import File, UploadFile
import shutil

@app.get("/schedule/open-time", status_code=status.HTTP_200_OK)
async def get_public_schedule_info():
    """현재 설정된 예약 오픈 시간을 공개적으로 반환합니다."""
    return {"open_datetime": RESERVATION_OPEN_DATETIME.isoformat()}

@app.post("/admin/upload/users", status_code=status.HTTP_200_OK)
async def upload_user_list(admin: dict = Depends(get_current_admin_user), file: UploadFile = File(...)):
    """관리자가 user_list.csv 파일을 업로드하여 사용자 정보를 갱신합니다."""
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV 파일만 업로드할 수 있습니다.")
    
    try:
        # 업로드된 파일을 서버에 저장
        with open(auth_manager.filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # 메모리에 로드된 사용자 정보 갱신
        auth_manager.reload_users()
        
        return {"message": f"'{file.filename}' 파일이 성공적으로 업로드되어 사용자 정보가 갱신되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"파일 처리 중 오류 발생: {e}")
    finally:
        file.file.close()

@app.get("/time")
async def get_current_server_time():
    # UTC 기준 현재 시간을 ISO 8601 형식 문자열로 반환
    return {"server_time": datetime.now(timezone.utc).isoformat()}