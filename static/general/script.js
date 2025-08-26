document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = 'https://mugeunji-scheduler.onrender.com';
    const WS_URL = `wss://mugeunji-scheduler.onrender.com/ws`;
    // const API_BASE_URL = 'http://127.0.0.1:8000';
    // const WS_URL = `ws://127.0.0.1:8000/ws`;

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

    async function fetchWithAuth(endpoint, options = {}) {
        const token = localStorage.getItem('accessToken');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        };

        const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

        // 토큰 만료 또는 인증 실패 시 자동 로그아웃 처리
        if (response.status === 401 || response.status === 403) {
            handleLogout('세션이 만료되어 자동으로 로그아웃됩니다. 다시 로그인해주세요.');
            // 추가적인 에러 전파를 막기 위해 에러를 던짐
            throw new Error('세션 만료'); 
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || '요청 처리 중 오류가 발생했습니다.');
        }
        return data;
    }
    
    // --- [수정] 로그아웃 로직을 함수로 분리 ---
    function handleLogout(message = '로그아웃 되었습니다.') {
        if(socket) {
            socket.close();
            socket = null;
        }
        localStorage.clear();
        showMessage(message, 'success');
        // UI를 즉시 갱신하거나, 페이지를 새로고침하여 로그인 화면으로 이동
        setTimeout(() => window.location.reload(), 500);
    }


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

            localStorage.setItem('accessToken', data.access_token);
            localStorage.setItem('username', username);
            localStorage.setItem('allowedHours', data.allowed_hours);

            showMessage('로그인 성공!', 'success');
            updateUI();

        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    logoutButton.addEventListener('click', () => handleLogout());

    submitReservationButton.addEventListener('click', async () => {
        const selectedSlots = document.querySelectorAll('.time-slot.selected');
        if (selectedSlots.length === 0) {
            showMessage('예약할 시간을 선택해주세요.', 'error');
            return;
        }

        const reservationDetails = Array.from(selectedSlots).map(slot => ({
            day: slot.dataset.day,
            time_index: parseInt(slot.dataset.timeIndex, 10)
        }));

        try {
            // --- [수정] fetch 대신 fetchWithAuth 사용 ---
            const data = await fetchWithAuth('/reserve', {
                method: 'POST',
                body: JSON.stringify({ reservations: reservationDetails })
            });

            showMessage(data.message, 'success');
            selectedSlots.forEach(slot => slot.classList.remove('selected'));

        } catch (error) {
            // 세션 만료 에러는 fetchWithAuth에서 처리하므로, 그 외의 에러만 표시
            if (error.message !== '세션 만료') {
                showMessage(error.message, 'error');
            }
        }
    });

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
                        
                        noticeDiv.className = 'message-success'; 
                        noticeDiv.textContent = `📢 다음 예약은 ${formattedTime}부터 가능합니다.`;
                        noticeDiv.style.display = 'block';

                    } else if (data.reservation_enabled) {
                        noticeDiv.className = 'message-success';
                        noticeDiv.textContent = '✅ 현재 예약이 가능합니다.';
                        noticeDiv.style.display = 'block';

                    } else {
                        noticeDiv.className = 'message-error';
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

    function showMessage(message, type = 'info') {
        messageArea.textContent = message;
        messageArea.className = `message-${type}`;
        setTimeout(() => {
            messageArea.textContent = '';
            messageArea.className = '';
        }, 4000);
    }

    function generateReservationGrid() {
        const dayMap = {
            "Monday": "월요일", "Tuesday": "화요일", "Wednesday": "수요일",
            "Thursday": "목요일", "Friday": "금요일", "Saturday": "토요일", "Sunday": "일요일"
        };
        const days = Object.keys(dayMap);
        let tableHTML = '<table class="reservation-table"><thead><tr><th>시간</th>';
        days.forEach(day => tableHTML += `<th>${dayMap[day]}</th>`);
        tableHTML += '</tr></thead><tbody>';
        for (let time = 0; time < 24; time++) {
            tableHTML += `<tr><td class="time-header">${time}시`;
            days.forEach(day => {
                let groupAttribute = '';
                if (time >= 0 && time <= 5) {
                    groupAttribute = `data-group="${day}-group"`;
                }
                tableHTML += `<td class="time-slot" data-day="${day}" data-time-index="${time}" ${groupAttribute}></td>`;
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
                const group = slot.dataset.group;
                if (group) {
                    const isSelected = slot.classList.contains('selected');
                    document.querySelectorAll(`.time-slot[data-group="${group}"]`).forEach(groupSlot => {
                        if (groupSlot.classList.contains('reserved') || groupSlot.classList.contains('mine')) {
                            return;
                        }
                        if (isSelected) {
                            groupSlot.classList.remove('selected');
                        } else {
                            groupSlot.classList.add('selected');
                        }
                    });
                } else {
                    slot.classList.toggle('selected');
                }
            });
        });
    }

    function updateGridWithReservations(reservations) {
        const selectedSlotsBeforeUpdate = new Set();
        document.querySelectorAll('.time-slot.selected').forEach(slot => {
            const uniqueId = `${slot.dataset.day}-${slot.dataset.timeIndex}`;
            selectedSlotsBeforeUpdate.add(uniqueId);
        });
        const currentUser = localStorage.getItem('username');
        document.querySelectorAll('.time-slot').forEach(slot => {
            slot.textContent = '';
            slot.classList.remove('reserved', 'mine', 'selected');
        });
        reservations.forEach(res => {
            const slot = document.querySelector(`td[data-day="${res.reservation_day}"][data-time-index="${res.time_index}"]`);
            if (slot) {
                slot.textContent = res.username;
                if (res.username == currentUser) {
                    slot.classList.add('mine');
                } else {
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