document.addEventListener('DOMContentLoaded', () => {
    // --- 상수 및 변수 선언 ---
    const API_BASE_URL = 'https://mugeunji-scheduler.onrender.com';
    const WS_URL = `wss://mugeunji-scheduler.onrender.com/ws`;
    // const API_BASE_URL = 'http://127.0.0.1:8000';
    // const WS_URL = `ws://127.0.0.1:8000/ws`;

    // 섹션 및 공통 요소
    const loginSection = document.getElementById('login-section');
    const mainSection = document.getElementById('main-section');
    const messageArea = document.getElementById('message-area');
    const loginMessageArea = document.getElementById('login-message-area');
    const welcomeMessage = document.getElementById('welcome-message');
    const gridContainer = document.getElementById('reservation-grid-container');

    // 폼 요소
    const loginForm = document.getElementById('admin-login-form');
    const logoutButton = document.getElementById('logout-button');
    const deleteReservationButton = document.getElementById('delete-reservation-button');
    const forceReserveButton = document.getElementById('force-reserve-button');
    const saveSettingsButton = document.getElementById('save-settings-button');
    const reservationEnabledCheckbox = document.getElementById('setting-reservation-enabled');
    const reservationOpensAtInput = document.getElementById('setting-opens-at');
    const clearAllReservationsButton = document.getElementById('clear-all-reservations-button');
    const csvFileInput = document.getElementById('csv-file-input');
    const uploadCsvButton = document.getElementById('upload-csv-button');
    const viewUsersButton = document.getElementById('view-users-button');

    // 모달 요소
    const userModal = document.getElementById('user-modal');
    const modalCloseButton = document.querySelector('.modal-close-button');
    const userListContainer = document.getElementById('user-list-container');
    
    let socket = null;

    // --- 이벤트 리스너 ---
    updateUI();
    loginForm.addEventListener('submit', handleLogin);
    logoutButton.addEventListener('click', () => handleLogout()); // 인자 이 호출
    deleteReservationButton.addEventListener('click', handleDeleteReservation);
    forceReserveButton.addEventListener('click', handleForceReservation);
    saveSettingsButton.addEventListener('click', handleSaveSettings);
    uploadCsvButton.addEventListener('click', handleCsvUpload);
    viewUsersButton.addEventListener('click', handleViewUsers);
    modalCloseButton.addEventListener('click', () => userModal.classList.add('hidden'));
    clearAllReservationsButton.addEventListener('click', handleClearAllReservations);
    userModal.addEventListener('click', (e) => {
        if (e.target === userModal) userModal.classList.add('hidden');
    });

    // --- 이벤트 핸들러 함수 ---
    async function handleLogin(e) {
        e.preventDefault();
        const username = e.target.username.value;
        const password = e.target.password.value;
        try {
            const response = await fetch(`${API_BASE_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || '로그인 실패');
            localStorage.setItem('adminAccessToken', data.access_token);
            localStorage.setItem('adminUsername', username);
            showMessage('관리자 로그인 성공!', 'success');
            updateUI();
        } catch (error) { showMessage(error.message, 'error'); }
    }

    function handleLogout(message = '로그아웃 되었습니다.') {
        if (socket) socket.close();
        localStorage.removeItem('adminAccessToken');
        localStorage.removeItem('adminUsername');
        showMessage(message, 'success');
        setTimeout(() => window.location.reload(), 500);
    }

    async function handleClearAllReservations() {
        if (confirm('정말로 모든 신청 기록을 삭제하고 시간표를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
            try {
                const response = await fetchWithAuth('/admin/reservations/clear');
                showMessage(response.message, 'success');
            } catch (error) {
                if (error.message !== '세션 만료') showMessage(error.message, 'error');
            }
        } else {
            showMessage('초기화 작업이 취소되었습니다.');
        }
    }

    async function handleDeleteReservation() {
        const selectedSlots = getSelectedSlots();
        if (selectedSlots.length === 0) return showMessage('삭제할 시간을 먼저 선택해주세요.', 'error');
        const reservationsToDelete = selectedSlots.map(slot => ({
            day: slot.dataset.day,
            time_index: parseInt(slot.dataset.timeIndex, 10)
        }));
        try {
            const response = await fetchWithAuth('/admin/reservations/delete', {
                method: 'POST',
                body: JSON.stringify({ reservations: reservationsToDelete })
            });
            showMessage(response.message, 'success');
            document.querySelectorAll('.time-slot.selected').forEach(s => s.classList.remove('selected'));
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function handleForceReservation() {
        const targetUsername = document.getElementById('target-username').value;
        if (!targetUsername) return showMessage('대상 사용자명을 입력해주세요.', 'error');
        const selectedSlots = getSelectedSlots();
        if (selectedSlots.length === 0) return showMessage('예약할 시간을 먼저 선택해주세요.', 'error');
        const reservationsToCreate = selectedSlots.map(slot => ({
            day: slot.dataset.day,
            time_index: parseInt(slot.dataset.timeIndex, 10)
        }));
        const payload = { target_username: targetUsername, reservations: reservationsToCreate };
        try {
            const response = await fetchWithAuth('/admin/reservations/create', { method: 'POST', body: JSON.stringify(payload) });
            showMessage(response.message, 'success');
            document.querySelectorAll('.time-slot.selected').forEach(s => s.classList.remove('selected'));
            document.getElementById('target-username').value = '';
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function handleSaveSettings() {
        const opensAtValue = reservationOpensAtInput.value;
        const payload = {
            reservation_enabled: reservationEnabledCheckbox.checked,
            reservation_opens_at: opensAtValue ? new Date(opensAtValue).toISOString() : null
        };
        try {
            const response = await fetchWithAuth('/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
            showMessage(response.message, 'success');
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function handleCsvUpload() {
        const file = csvFileInput.files[0];
        if (!file) return showMessage('업로드할 CSV 파일을 선택해주세요.', 'error');
        const formData = new FormData();
        formData.append('file', file);
        try {
            // 이 요청은 fetchWithAuth를 사용하지 않으므로 직접 헤더를 설정합니다.
            const token = localStorage.getItem('adminAccessToken');
            const response = await fetch(`${API_BASE_URL}/admin/users/upload-csv`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }, // JSON 타입이 아니므로 Content-Type 생략
                body: formData
            });

            if (response.status === 401 || response.status === 403) {
                 handleLogout('세션이 만료되어 자동으로 로그아웃됩니다.');
                 return;
            }

            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'CSV 업로드 실패');
            showMessage(data.message, 'success');
            csvFileInput.value = '';
        } catch (error) {
            showMessage(error.message, 'error');
        }
    }

    async function handleViewUsers() {
        try {
            const users = await fetchWithAuth('/admin/users');
            let tableHTML = `<table class="user-list-table">
                <thead><tr><th>사용자명</th><th>허용시간</th><th>역할</th></tr></thead><tbody>`;
            users.forEach(user => {
                tableHTML += `<tr><td>${user.username}</td><td>${user.allowed_hours}</td><td>${user.role}</td></tr>`;
            });
            tableHTML += '</tbody></table>';
            userListContainer.innerHTML = tableHTML;
            userModal.classList.remove('hidden');
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    // --- 헬퍼 및 기타 함수 ---
    function updateUI() {
        const token = localStorage.getItem('adminAccessToken');
        if (token) {
            loginSection.classList.add('hidden');
            mainSection.classList.remove('hidden');
            welcomeMessage.textContent = `${localStorage.getItem('adminUsername')}님, 환영합니다.`;
            connectWebSocket();
            generateReservationGrid();
            loadAdminSettings();
        } else {
            loginSection.classList.remove('hidden');
            mainSection.classList.add('hidden');
        }
    }

    function connectWebSocket() {
        if (socket && socket.readyState === WebSocket.OPEN) return;
        socket = new WebSocket(WS_URL);
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'RESERVATION_UPDATE') {
                updateGridWithReservations(message.data);
            }
        };
    }

    function generateReservationGrid() {
        const dayMap = { "Monday": "월", "Tuesday": "화", "Wednesday": "수", "Thursday": "목", "Friday": "금", "Saturday": "토", "Sunday": "일" };
        const days = Object.keys(dayMap);
        let tableHTML = '<table class="reservation-table"><thead><tr><th>시간</th>';
        days.forEach(day => tableHTML += `<th>${dayMap[day]}</th>`);
        tableHTML += '</tr></thead><tbody>';
        for (let time = 0; time < 24; time++) {
            tableHTML += `<tr><td class="time-header">${time}:00</td>`;
            days.forEach(day => {
                let groupAttribute = '';
                if (time >= 0 && time <= 5) {
                    groupAttribute = `data-group="${day}-group"`;
                }
                tableHTML += `<td class="time-slot" data-day="${day}" data-time-index="${time}" ${groupAttribute}></td>`;
            });
            tableHTML += '</tr>';
        }
        gridContainer.innerHTML = tableHTML + '</tbody></table>';

        gridContainer.querySelectorAll('.time-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                const group = slot.dataset.group;
                if (group) {
                    const isSelected = slot.classList.contains('selected');
                    document.querySelectorAll(`.time-slot[data-group="${group}"]`).forEach(groupSlot => {
                        if (isSelected) {
                            slot.classList.remove('selected');
                        } else {
                            groupSlot.classList.add('selected');
                        }
                    });
                } else {
                    // 그룹이 없는 경우 기존 로직 유지
                    slot.classList.toggle('selected');
                }
            });
        });
    }

    function updateGridWithReservations(reservations) {
        document.querySelectorAll('.time-slot').forEach(slot => {
            slot.textContent = '';
            const wasSelected = slot.classList.contains('selected');
            slot.className = 'time-slot';
            if (wasSelected) slot.classList.add('selected');
        });
        reservations.forEach(res => {
            const slot = document.querySelector(`td[data-day="${res.reservation_day}"][data-time-index="${res.time_index}"]`);
            if (slot) {
                slot.textContent = res.username;
                slot.classList.add(res.username === localStorage.getItem('adminUsername') ? 'mine' : 'reserved');
            }
        });
    }

    async function loadAdminSettings() {
        try {
            const settings = await fetchWithAuth('/admin/settings');
            reservationEnabledCheckbox.checked = settings.reservation_enabled;
            if (settings.reservation_opens_at) {
                const kstDate = new Date(settings.reservation_opens_at);
                const year = kstDate.getFullYear();
                const month = (kstDate.getMonth() + 1).toString().padStart(2, '0');
                const day = kstDate.getDate().toString().padStart(2, '0');
                const hours = kstDate.getHours().toString().padStart(2, '0');
                const minutes = kstDate.getMinutes().toString().padStart(2, '0');
                reservationOpensAtInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
            } else {
                reservationOpensAtInput.value = '';
            }
        } catch (error) {
            if (error.message !== '세션 만료') showMessage('설정 정보를 불러오는 데 실패했습니다.', 'error');
        }
    }
    
    function getSelectedSlots() { return Array.from(document.querySelectorAll('.time-slot.selected')); }

    function showMessage(message, type = 'info') {
        loginMessageArea.textContent = message;
        loginMessageArea.className = type === 'success' ? 'message-success' : 'message-error';
        messageArea.textContent = message;
        messageArea.className = type === 'success' ? 'message-success' : 'message-error';
        setTimeout(() => { messageArea.textContent = ''; messageArea.className = ''; }, 4000);
        setTimeout(() => { loginMessageArea.textContent = ''; loginMessageArea.className = ''; }, 4000);
    }

    // --- [수정] fetchWithAuth 함수 수정 ---
    async function fetchWithAuth(endpoint, options = {}) {
        const token = localStorage.getItem('adminAccessToken');
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401 || response.status === 403) {
            handleLogout('세션이 만료되어 자동으로 로그아웃됩니다. 다시 로그인해주세요.');
            throw new Error('세션 만료');
        }
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || '요청 처리 중 오류 발생');
        }
        return data;
    }
});