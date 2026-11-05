#!/bin/bash
# 작업실 맥미니 잠금: 예약된 시간에만 일반 계정을 쓸 수 있게 한다. launchd가 1분마다 root로 실행한다.
# 설정: /usr/local/etc/workroom-guard.conf (SERVER_URL, DEVICE_API_KEY, GUEST_USER). 설치는 docs/macmini-guard.md
set -u
. /usr/local/etc/workroom-guard.conf

STATE=/var/db/workroom-guard
CACHE=$STATE/schedule      # 서버에서 받은 사용 구간: 한 줄에 "시작 끝"(유닉스 초)
ACTIVE=$STATE/active_end   # 지금 열어 둔 구간의 끝
WARNED=$STATE/warned       # 종료 경고를 어디까지 띄웠는지 ("끝:10" / "끝:5")
mkdir -p "$STATE" && chmod 700 "$STATE"
now=$(date +%s)
uid=$(id -u "$GUEST_USER") || exit 1

# 서버에 못 닿으면 마지막으로 받은 일정으로 판단한다 (일정이 끝나면 자연히 잠긴다)
tmp=$(mktemp "$STATE/fetch.XXXXXX")
if curl -fsS --max-time 15 -H "Authorization: Bearer $DEVICE_API_KEY" "$SERVER_URL/api/device/schedule" -o "$tmp"; then
  mv "$tmp" "$CACHE"
else
  rm -f "$tmp"
fi
end=$(awk -v n="$now" '$1 <= n && n < $2 { print $2; exit }' "$CACHE" 2>/dev/null)

logged_in() { launchctl print "gui/$uid" >/dev/null 2>&1; }

tell_user() {
  launchctl asuser "$uid" sudo -u "$GUEST_USER" osascript -e \
    "display dialog \"$1\" with title \"작업실\" buttons {\"확인\"} default button 1 with icon caution giving up after 120" \
    >/dev/null 2>&1 &
}

kick() {
  if logged_in; then
    launchctl bootout "gui/$uid" 2>/dev/null
    sleep 5
    logged_in && pkill -KILL -u "$uid"
  fi
  rm -f "$ACTIVE" "$WARNED"
}

if [ -n "$end" ]; then
  # 앞 구간이 이미 끝났는데 세션이 남아 있으면(다른 사람 예약이 바로 이어짐) 한 번 내보낸다
  prev=$(cat "$ACTIVE" 2>/dev/null || echo "$end")
  [ "$prev" -le "$now" ] && kick
  echo "$end" > "$ACTIVE"
  pwpolicy -u "$GUEST_USER" -enableuser >/dev/null 2>&1

  left=$(( (end - now + 59) / 60 ))
  warned=$(cat "$WARNED" 2>/dev/null)
  if logged_in; then
    if [ "$left" -le 5 ] && [ "$warned" != "$end:5" ]; then
      tell_user "예약 시간이 ${left}분 남았어요. 지금 작업을 저장해 주세요. 시간이 끝나면 자동으로 로그아웃돼요."
      echo "$end:5" > "$WARNED"
    elif [ "$left" -le 10 ] && [ "${warned%%:*}" != "$end" ]; then
      tell_user "예약 시간이 ${left}분 남았어요. 시간이 끝나면 자동으로 로그아웃되니 작업을 저장해 주세요."
      echo "$end:10" > "$WARNED"
    fi
  fi
else
  kick
  pwpolicy -u "$GUEST_USER" -disableuser >/dev/null 2>&1
fi
