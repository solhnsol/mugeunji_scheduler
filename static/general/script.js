document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = 'https://mugeunji-scheduler.onrender.com';
    const WS_URL = `wss://mugeunji-scheduler.onrender.com/ws`;

    const loginSection = document.getElementById('login-section');
    const reservationSection = document.getElementById('reservation-section');
    const loginForm = document.getElementById('login-form');
    const logoutButton = document.getElementById('logout-button');
    const messageArea = document.getElementById('message-area');
    const welcomeMessage = document.getElementById('welcome-message');
    const allowedHoursElem = document.getElementById('allowed-hours');
    const gridContainer = document.getElementById('reservation-grid-container');
    const submitReservationButton = document.getElementById('submit-reservation-button');
    
    let socket = null;

    updateUI();

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = e.target.username.value;
        const password = e.target.password.value;

        try {
            const response = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || '로그인에 실패했습니다.');
            }

            // 토큰과 사용자 정보 저장
            localStorage.setItem('accessToken', data.access_token);
            localStorage.setItem('username', username);
            localStorage.setItem('allowedHours', data.allowed_hours);

            showMessage('로그인 성공!', 'success');
            updateUI();

        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    // 로그아웃 버튼 클릭 이벤트 리스너
    logoutButton.addEventListener('click', () => {
        if(socket){
            socket.close();
            socket = null;
        }
        localStorage.clear();
        showMessage('로그아웃 되었습니다.', 'success');
        updateUI();
    });

    // 예약 제출 버튼 클릭 이벤트 리스너
    submitReservationButton.addEventListener('click', async () => {
        const selectedSlots = document.querySelectorAll('.time-slot.selected');
        if (selectedSlots.length === 0) {
            showMessage('예약할 시간을 선택해주세요.', 'error');
            return;
        }

        // 1. 'reservations' 변수명을 'reservationDetails' 등으로 명확하게 변경 (권장)
        const reservationDetails = Array.from(selectedSlots).map(slot => ({
            day: slot.dataset.day,
            time_index: parseInt(slot.dataset.timeIndex, 10)
        }));

        const token = localStorage.getItem('accessToken');

        try {
            const response = await fetch(`${API_BASE_URL}/reserve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                // 2. 서버 요구사항에 맞게 reservationDetails를 'reservations' 키로 감싸서 전송
                body: JSON.stringify({ reservations: reservationDetails })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || '예약에 실패했습니다.');
            }

            showMessage(data.message, 'success');
            // 예약 성공 후 선택된 슬롯들 초기화 (이 부분은 원래 코드에도 잘 되어 있습니다)
            selectedSlots.forEach(slot => slot.classList.remove('selected'));

        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    // 로그인 상태에 따라 UI를 변경하는 함수
    function updateUI() {
        const token = localStorage.getItem('accessToken');
        const noticeDiv = document.getElementById('reservation-notice');
        if (token) {
            loginSection.classList.add('hidden');
            reservationSection.classList.remove('hidden');
            welcomeMessage.textContent = localStorage.getItem('username');
            allowedHoursElem.textContent = localStorage.getItem('allowedHours');
            fetch(`${API_BASE_URL}/settings`)
                .then(response => response.json())
                .then(data => {
                    if (data.reservation_opens_at) {
                        const opensAt = new Date(data.reservation_opens_at);
                        const options = {
                            year: 'numeric', month: 'long', day: 'numeric',
                            hour: '2-digit', minute: '2-digit', hour12: false
                        };
                        const formattedTime = opensAt.toLocaleString('ko-KR', options);
                        
                        // 스타일과 메시지 설정
                        noticeDiv.className = 'message-success'; 
                        noticeDiv.textContent = `📢 다음 예약은 ${formattedTime}부터 가능합니다.`;
                        noticeDiv.style.display = 'block';

                    } else if (data.reservation_enabled) {
                        // 스타일과 메시지 설정
                        noticeDiv.className = 'message-success';
                        noticeDiv.textContent = '✅ 현재 예약이 가능합니다.';
                        noticeDiv.style.display = 'block';

                    } else {
                        // 스타일과 메시지 설정
                        noticeDiv.className = 'message-error'; // 에러 스타일 적용
                        noticeDiv.textContent = '❌ 현재 예약이 불가능합니다.';
                        noticeDiv.style.display = 'block';
                    }
                })
                .catch(error => {
                    console.error('설정 정보를 가져오는 데 실패했습니다:', error);
                    noticeDiv.textContent = '';
                    noticeDiv.style.display = 'none';
                });
            if(!socket){
                socket = new WebSocket(WS_URL)

                socket.onmessage = handleSocketMessage;
            }


            generateReservationGrid();
        } else {
            // 로그아웃 상태
            loginSection.classList.remove('hidden');
            reservationSection.classList.add('hidden');
        }
    }

    function handleSocketMessage(event) {
        const message = JSON.parse(event.data);

        if (message.type === 'RESERVATION_UPDATE') {
            updateGridWithReservations(message.data);
        }
    }

    // 사용자에게 메시지를 보여주는 함수
    function showMessage(message, type = 'info') {
        messageArea.textContent = message;
        messageArea.className = `message-${type}`;
        setTimeout(() => {
            messageArea.textContent = '';
            messageArea.className = '';
        }, 4000); // 4초 후에 메시지 사라짐
    }

    // 예약 시간 선택 그리드를 동적으로 생성하는 함수
    function generateReservationGrid() {
        const dayMap = {
            "Monday": "월요일",
            "Tuesday": "화요일",
            "Wednesday": "수요일",
            "Thursday": "목요일",
            "Friday": "금요일",
            "Saturday": "토요일",
            "Sunday": "일요일"
        };

        const days = Object.keys(dayMap);

        let tableHTML = '<table class="reservation-table"><thead><tr><th>시간</th>';

        days.forEach(day => tableHTML += `<th>${dayMap[day]}</th>`);
        tableHTML += '</tr></thead><tbody>';

        for (let time = 0; time < 24; time++) {
            tableHTML += `<tr><td class="time-header">${time}시`;
            days.forEach(day => {
                tableHTML += `<td class="time-slot" data-day="${day}" data-time-index="${time}"></td>`;
            });
            tableHTML += '</tr>';
        }
        tableHTML += '</tbody></table>';
        gridContainer.innerHTML = tableHTML;

        gridContainer.querySelectorAll('.time-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                if (slot.classList.contains('reserved') || slot.classList.contains('mine')) {
                    return;
                }
                slot.classList.toggle('selected');
            });
        });
    }

    function updateGridWithReservations(reservations) {
        const selectedSlotsBeforeUpdate = new Set();
        document.querySelectorAll('.time-slot.selected').forEach(slot => {
            const uniqueId = `${slot.dataset.day}-${slot.dataset.timeIndex}`;
            selectedSlotsBeforeUpdate.add(uniqueId);
        });

        const currentUser = localStorage.getItem('username')

        document.querySelectorAll('.time-slot').forEach(slot => {
            slot.textContent = '';
            slot.classList.remove('reserved', 'mine', 'selected');
        });

        reservations.forEach(res => {
            const slot = document.querySelector(
                `td[data-day="${res.reservation_day}"][data-time-index="${res.time_index}"]`
            );

            if (slot) {
                slot.textContent = res.username;
                if (res.username == currentUser) {
                    slot.classList.add('mine');
                }
                else {
                    slot.classList.add('reserved');
                }
            }
        });

        selectedSlotsBeforeUpdate.forEach(uniqueId => {
            const [day, timeIndex] = uniqueId.split('-');
            const slot = document.querySelector(`td[data-day="${day}"][data-time-index="${timeIndex}"]`);

            if (slot && !slot.classList.contains('reserved') && !slot.classList.contains('mine')) {
                slot.classList.add('selected');
            }
        });
    }
});