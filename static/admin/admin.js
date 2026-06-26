document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = '';
    const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

    const loginSection = document.getElementById('login-section');
    const mainSection = document.getElementById('main-section');
    const messageArea = document.getElementById('message-area');
    const loginMessageArea = document.getElementById('login-message-area');
    const welcomeMessage = document.getElementById('welcome-message');
    const gridContainer = document.getElementById('reservation-grid-container');

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
    const openSettlementButton = document.getElementById('open-settlement-button');
    const closeSettlementButton = document.getElementById('close-settlement-button');
    const copySettlementTextButton = document.getElementById('copy-settlement-text-button');
    const settlementPeriodInput = document.getElementById('settlement-period');
    const settlementStatusDiv = document.getElementById('settlement-status');
    const billingListContainer = document.getElementById('billing-list-container');
    const planPricesContainer = document.getElementById('plan-prices-container');
    const editUserModal = document.getElementById('edit-user-modal');
    const editUserForm = document.getElementById('edit-user-form');

    const userModal = document.getElementById('user-modal');
    const modalCloseButton = document.querySelector('.modal-close-button');
    const editModalCloseButton = document.querySelector('.edit-close');
    const userListContainer = document.getElementById('user-list-container');

    let socket = null;
    let cachedPlans = [];
    let currentSettlementPeriod = null;

    updateUI();
    loginForm.addEventListener('submit', handleLogin);
    logoutButton.addEventListener('click', () => handleLogout());
    deleteReservationButton.addEventListener('click', handleDeleteReservation);
    forceReserveButton.addEventListener('click', handleForceReservation);
    saveSettingsButton.addEventListener('click', handleSaveSettings);
    uploadCsvButton.addEventListener('click', handleCsvUpload);
    viewUsersButton.addEventListener('click', handleViewUsers);
    openSettlementButton.addEventListener('click', handleOpenSettlement);
    closeSettlementButton.addEventListener('click', handleCloseSettlement);
    copySettlementTextButton.addEventListener('click', handleCopySettlementText);
    editUserForm.addEventListener('submit', handleSaveUserEdit);
    modalCloseButton.addEventListener('click', () => userModal.classList.add('hidden'));
    editModalCloseButton.addEventListener('click', () => editUserModal.classList.add('hidden'));
    clearAllReservationsButton.addEventListener('click', handleClearAllReservations);
    userModal.addEventListener('click', (e) => {
        if (e.target === userModal) userModal.classList.add('hidden');
    });
    editUserModal.addEventListener('click', (e) => {
        if (e.target === editUserModal) editUserModal.classList.add('hidden');
    });

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
            sessionStorage.setItem('adminAccessToken', data.access_token);
            sessionStorage.setItem('adminUsername', username);
            showMessage('관리자 로그인 성공!', 'success');
            updateUI();
        } catch (error) { showMessage(error.message, 'error'); }
    }

    function handleLogout(message = '로그아웃 되었습니다.') {
        if (socket) socket.close();
        sessionStorage.removeItem('adminAccessToken');
        sessionStorage.removeItem('adminUsername');
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
            const token = sessionStorage.getItem('adminAccessToken');
            const response = await fetch(`${API_BASE_URL}/admin/users/upload-csv`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
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
                <thead><tr>
                    <th>사용자</th><th>이메일</th><th>요금제</th><th>시간</th><th>월비용</th><th>상태</th><th></th>
                </tr></thead><tbody>`;
            users.forEach(user => {
                tableHTML += `<tr>
                    <td>${user.username}</td>
                    <td>${user.email || '-'}</td>
                    <td>${user.plan_name || '-'}</td>
                    <td>${user.allowed_hours}</td>
                    <td>${formatPrice(user.monthly_price)}</td>
                    <td>${user.subscription_status || '-'}</td>
                    <td><button class="btn-link edit-user-btn" data-username="${user.username}">수정</button></td>
                </tr>`;
            });
            tableHTML += '</tbody></table>';
            userListContainer.innerHTML = tableHTML;
            userListContainer.querySelectorAll('.edit-user-btn').forEach(btn => {
                btn.addEventListener('click', () => openEditUserModal(btn.dataset.username, users));
            });
            userModal.classList.remove('hidden');
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function loadPlans() {
        if (cachedPlans.length) return cachedPlans;
        const response = await fetch(`${API_BASE_URL}/plans`);
        cachedPlans = await response.json();
        return cachedPlans;
    }

    async function openEditUserModal(username, users) {
        const user = users.find(u => u.username === username);
        if (!user) return;
        const plans = await loadPlans();
        const planSelect = document.getElementById('edit-plan');
        planSelect.innerHTML = plans.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        const matchedPlan = plans.find(p => p.name === user.plan_name);
        if (matchedPlan) planSelect.value = matchedPlan.id;
        document.getElementById('edit-username').value = username;
        document.getElementById('edit-custom-hours').value = '';
        document.getElementById('edit-custom-fee').value = '';
        document.getElementById('edit-auto-renew').checked = true;
        editUserModal.classList.remove('hidden');
    }

    async function handleSaveUserEdit(e) {
        e.preventDefault();
        const username = document.getElementById('edit-username').value;
        const customHoursVal = document.getElementById('edit-custom-hours').value;
        const customFeeVal = document.getElementById('edit-custom-fee').value;
        const payload = {
            plan_id: parseInt(document.getElementById('edit-plan').value, 10),
            auto_renew: document.getElementById('edit-auto-renew').checked,
            clear_custom_hours: customHoursVal === '',
            clear_custom_fee: customFeeVal === '',
        };
        if (customHoursVal !== '') payload.custom_allowed_hours = parseInt(customHoursVal, 10);
        if (customFeeVal !== '') payload.custom_monthly_fee = parseInt(customFeeVal, 10);
        try {
            const response = await fetchWithAuth(`/admin/users/${encodeURIComponent(username)}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            showMessage(response.message, 'success');
            editUserModal.classList.add('hidden');
            await loadSettlementData();
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function handleOpenSettlement() {
        const period = settlementPeriodInput.value.trim();
        if (!period && !confirm('정산 기간을 입력하지 않았습니다. 다음 달로 자동 설정합니다. 계속할까요?')) return;
        if (period && !confirm(`${period} 다음 달 정산을 열겠습니까?`)) return;
        try {
            const response = await fetchWithAuth('/admin/settlement/open', {
                method: 'POST',
                body: JSON.stringify({ period: period || null }),
            });
            showMessage(response.message, 'success');
            await loadSettlementData();
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function handleCloseSettlement() {
        if (!confirm('현재 열린 정산을 마감하시겠습니까?')) return;
        try {
            const response = await fetchWithAuth('/admin/settlement/close', {
                method: 'POST',
                body: JSON.stringify({ period: currentSettlementPeriod }),
            });
            showMessage(response.message, 'success');
            await loadSettlementData();
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function handleCopySettlementText() {
        if (!currentSettlementPeriod) return showMessage('정산 기간이 없습니다.', 'error');
        try {
            const data = await fetchWithAuth(`/admin/settlement/copy-text?period=${currentSettlementPeriod}`);
            await navigator.clipboard.writeText(data.text);
            showMessage('정산 문구가 클립보드에 복사되었습니다.', 'success');
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function handleConfirmPayment(billingId) {
        if (!confirm('입금을 확인하시겠습니까?')) return;
        try {
            const response = await fetchWithAuth('/admin/billing/confirm', {
                method: 'POST',
                body: JSON.stringify({ billing_id: billingId }),
            });
            showMessage(response.message, 'success');
            await loadSettlementData();
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    function formatPrice(amount) {
        if (amount === null || amount === undefined) return '-';
        return `${Number(amount).toLocaleString()}원`;
    }

    async function loadPlanPrices() {
        const plans = await loadPlans();
        planPricesContainer.innerHTML = plans.map(plan => `
            <div class="plan-price-row">
                <span>${plan.name} (${plan.allowed_hours}h)</span>
                <input type="number" min="0" value="${plan.monthly_price}" data-plan-id="${plan.id}">
                <button type="button" class="save-plan-price-btn" data-plan-id="${plan.id}">저장</button>
            </div>
        `).join('');
        planPricesContainer.querySelectorAll('.save-plan-price-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const planId = btn.dataset.planId;
                const input = planPricesContainer.querySelector(`input[data-plan-id="${planId}"]`);
                try {
                    const response = await fetchWithAuth(`/admin/plans/${planId}`, {
                        method: 'PUT',
                        body: JSON.stringify({ monthly_price: parseInt(input.value, 10) || 0 }),
                    });
                    showMessage(response.message, 'success');
                    cachedPlans = [];
                } catch (error) {
                    if (error.message !== '세션 만료') showMessage(error.message, 'error');
                }
            });
        });
    }

    async function loadSettlementData() {
        try {
            const data = await fetchWithAuth('/admin/settlement');
            currentSettlementPeriod = data.period;
            if (!settlementPeriodInput.value) {
                settlementPeriodInput.placeholder = `예: ${data.suggested_next_period}`;
            }

            const open = data.open_settlement;
            const summary = data.summary || {};
            settlementStatusDiv.innerHTML = `
                <p><strong>조회 기간:</strong> ${data.period} (다음 달 이용분)</p>
                <p><strong>접근 허용 기간:</strong> ${data.current_access_period || '미설정'}</p>
                <p><strong>정산 상태:</strong> ${open ? `열림 (${open.period})` : '닫힘'}</p>
                <p>신규 ${summary.new || 0} · 유지 ${summary.renewal || 0} · 변경 ${summary.plan_change || 0} · 미입금 ${summary.pending || 0} · 완료 ${summary.paid || 0}</p>
            `;

            if (!data.items || data.items.length === 0) {
                billingListContainer.innerHTML = '<p>청구 내역이 없습니다. 정산을 열어주세요.</p>';
                return;
            }

            let html = `<table class="user-list-table"><thead><tr>
                <th>사용자</th><th>요금제</th><th>금액</th><th>변동</th><th>상태</th><th></th>
            </tr></thead><tbody>`;
            data.items.forEach(item => {
                const paid = item.status === 'paid';
                html += `<tr>
                    <td>${item.username}</td>
                    <td>${item.plan_name}</td>
                    <td>${formatPrice(item.amount)}</td>
                    <td>${item.change_label}</td>
                    <td class="${paid ? 'paid' : 'pending'}">${paid ? '입금완료' : '미입금'}</td>
                    <td>${paid ? '' : `<button class="confirm-pay-btn" data-id="${item.id}">입금 확인</button>`}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            billingListContainer.innerHTML = html;
            billingListContainer.querySelectorAll('.confirm-pay-btn').forEach(btn => {
                btn.addEventListener('click', () => handleConfirmPayment(parseInt(btn.dataset.id, 10)));
            });
        } catch (error) {
            if (error.message !== '세션 만료') showMessage('정산 정보를 불러오지 못했습니다.', 'error');
        }
    }

    function updateUI() {
        const token = sessionStorage.getItem('adminAccessToken');
        if (token) {
            loginSection.classList.add('hidden');
            mainSection.classList.remove('hidden');
            welcomeMessage.textContent = `${sessionStorage.getItem('adminUsername')}님, 환영합니다.`;
            connectWebSocket();
            generateReservationGrid();
            loadAdminSettings();
            loadSettlementData();
            loadPlanPrices();
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
                if (time >= 0 && time <= 3) {
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
                slot.classList.add(res.username === sessionStorage.getItem('adminUsername') ? 'mine' : 'reserved');
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

    async function fetchWithAuth(endpoint, options = {}) {
        const token = sessionStorage.getItem('adminAccessToken');
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
