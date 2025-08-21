# source/login.py

import pandas as pd
import os
from typing import Optional, Dict
import datetime

class AuthManager:
    """
    CSV 파일로부터 사용자 명단과 정보를 읽어 로그인 인증 및 사용자 관리를 처리하는 클래스.
    - 파일이 없을 경우, 테스트용 기본 데이터를 생성합니다.
    - 사용자 이름과 비밀번호를 받아 인증 결과를 반환합니다.
    - 사용자별 예약 가능 시간 및 역할을 관리합니다.
    """
    def __init__(self, filepath: str = "data/user_list.csv"):
        self.filepath = filepath
        self.users_df = self._load_users()

    def _load_users(self) -> pd.DataFrame:
        """사용자 목록 CSV 파일을 로드하거나, 파일이 없으면 새로 생성합니다."""
        if not os.path.exists(self.filepath):
            print(f"'{self.filepath}' 파일이 없어 테스트용 데이터를 생성합니다.")
            self._create_test_data()
        
        return pd.read_csv(self.filepath, dtype={'password': str})

    def _create_test_data(self):
        """테스트용 사용자 데이터프레임을 생성하고 CSV 파일로 저장합니다."""
        
        # [수정] role 열 추가
        test_data = {
            'username': ['홍길동', '김철수', '이영희', 'admin'],
            'password': ['1234', '5678', '9876', '0000'],
            'allowed_hours': [10, 5, 8, 99],
            'role': ['user', 'user', 'user', 'admin']
        }
        df = pd.DataFrame(test_data)
        
        os.makedirs(os.path.dirname(self.filepath), exist_ok=True)
        df.to_csv(self.filepath, index=False, encoding='utf-8-sig')

    def login(self, username: str, password: str) -> Optional[Dict]:
        """
        사용자 이름과 비밀번호를 받아 인증을 시도합니다.
        성공 시, 사용자 데이터가 담긴 딕셔너리를 반환합니다.
        실패 시, None을 반환합니다.
        """
        if self.users_df.empty:
            return None

        user_data = self.users_df[self.users_df['username'] == username]

        if user_data.empty:
            return None

        stored_password = user_data['password'].iloc[0]
        
        if stored_password == password:
            return user_data.iloc[0].to_dict()
        
        return None
    
    def get_allowed_hours(self, username: str) -> int:
        """사용자 이름으로 해당 사용자의 예약 가능 시간을 조회합니다."""
        if self.users_df.empty:
            return 0
        
        user_data = self.users_df[self.users_df['username'] == username]
        
        if user_data.empty:
            return 0
            
        return int(user_data['allowed_hours'].iloc[0])
    
    def reload_users(self):
        """CSV 파일로부터 사용자 데이터를 다시 로드하여 메모리를 갱신합니다."""
        print(f"[{datetime.datetime.now()}] 사용자 목록을 파일에서 다시 로드합니다...")
        self.users_df = self._load_users()