# 작업실 맥미니 잠금

예약된 시간에만 맥미니 일반 계정으로 로그인할 수 있게 한다. 추가 장비는 필요 없다.

- 맥미니가 1분마다 서버에서 앞으로 48시간의 사용 구간을 받아 온다 (`GET /api/device/schedule`). 이용자 정보는 오지 않는다.
- **예약 시간 중:** 일반 계정을 켠다. 종료 10분 전과 5분 전에 저장하라는 창을 띄운다.
- **예약 시간이 끝나면:** 강제로 로그아웃하고 계정을 끈다. 재부팅해도 로그인할 수 없다.
- 다른 사람 예약이 바로 이어지면 한 번 로그아웃시킨다. 앞사람 화면이 다음 사람에게 넘어가지 않게 하려는 것이다. 같은 사람이 이어서 예약했으면 끊지 않는다.
- 서버에 닿지 않으면 마지막으로 받은 일정대로 판단한다. 인터넷이 오래 끊기면 받아 둔 일정이 끝나는 시점에 잠긴다.
- 관리자 계정은 건드리지 않는다.

## 서버
1. `.env`에 `DEVICE_API_KEY=<긴 랜덤 문자열>`을 넣고 다시 띄운다. 키는 `python -c "import secrets; print(secrets.token_urlsafe(32))"`로 만든다.
2. 확인: `curl -H "Authorization: Bearer <키>" https://<사이트>/api/device/schedule`. 한 줄에 `시작 끝`(유닉스 초)이 나오면 된다. 예약이 없으면 빈 응답이다.

## 맥미니 (관리자 계정에서)
```bash
# 저장소의 scripts/macmini 폴더에서
sudo install -m 755 -o root -g wheel workroom-guard.sh /usr/local/bin/
sudo install -m 600 -o root -g wheel workroom-guard.conf.example /usr/local/etc/workroom-guard.conf
sudo nano /usr/local/etc/workroom-guard.conf   # 주소·키·일반 계정 이름(dscl . list /Users 로 확인) 채우기
sudo install -m 644 -o root -g wheel kr.mugeunji.workroom-guard.plist /Library/LaunchDaemons/
sudo launchctl bootstrap system /Library/LaunchDaemons/kr.mugeunji.workroom-guard.plist
```

맥미니 설정도 같이 확인한다.
- 일반 계정에 **관리자 권한이 없어야** 한다. 권한이 있으면 이용자가 이 장치를 끌 수 있다.
- 시스템 설정 → 사용자 및 그룹 → **자동 로그인: 끔**
- 맥미니 본체는 잠자지 않게 한다: `sudo pmset -a sleep 0`. 화면만 꺼지는 디스플레이 잠자기는 그대로 둬도 된다.
- 시간 자동 설정이 켜져 있어야 한다 (기본값).

## 확인·해제
- 로그: `/var/log/workroom-guard.log`, 받은 일정: `sudo cat /var/db/workroom-guard/schedule`
- 지금 바로 한 번 돌리기: `sudo /usr/local/bin/workroom-guard.sh`
- 잠금 끄기:
  ```bash
  sudo launchctl bootout system/kr.mugeunji.workroom-guard
  sudo pwpolicy -u <일반계정> -enableuser
  ```

## 처음 설치하고 꼭 해 볼 것
맥 전용 명령(`pwpolicy`, `launchctl bootout`)은 macOS 버전마다 동작이 조금씩 다르다. 그래서 1~2시간짜리 테스트 예약을 하나 넣고 아래를 직접 확인한다.
1. 예약 전에는 일반 계정으로 로그인이 안 된다.
2. 예약 시작 후 1분 안에 로그인이 된다.
3. 종료 10분 전과 5분 전에 알림 창이 뜬다.
4. 끝나면 로그아웃되고, 다시 로그인이 안 된다.
