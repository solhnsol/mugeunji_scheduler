document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = 'https://mugeunji-scheduler.onrender.com';
    const WS_URL = `wss://mugeunji-scheduler.onrender.com/ws`;
    // const API_BASE_URL = 'http://127.0.0.1:5000';
    // const WS_URL = `ws://127.0.0.1:5000/ws`;

    const loginSection = document.getElementById('login-section');
    const registerSection = document.getElementById('register-section');
    const planSection = document.getElementById('plan-section');
    const pendingSection = document.getElementById('pending-section');
    const reservationSection = document.getElementById('reservation-section');

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const messageArea = document.getElementById('message-area');

    let socket = null;
    let cachedPlans = [];
    let currentMe = null;

    document.getElementById('show-register-button').addEventListener('click', () => {
        loginSection.classList.add('hidden');
        registerSection.classList.remove('hidden');
    });
    document.getElementById('show-login-button').addEventListener('click', () => {
        registerSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
    });

    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
    document.getElementById('logout-button').addEventListener('click', () => handleLogout());
    document.getElementById('plan-logout-button').addEventListener('click', () => handleLogout());
    document.getElementById('pending-logout-button').addEventListener('click', () => handleLogout());
    document.getElementById('submit-reservation-button').addEventListener('click', handleSubmitReservation);

    updateUI();

    async function fetchWithAuth(endpoint, options = {}) {
        const token = sessionStorage.getItem('accessToken');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        };
        const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
        if (response.status === 401 || response.status === 403) {
            handleLogout('세션이 만료되어 자동으로 로그아웃됩니다. 다시 로그인해주세요.');
            throw new Error('세션 만료');
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || '요청 처리 중 오류가 발생했습니다.');
        }
        return data;
    }

    function handleLogout(message = '로그아웃 되었습니다.') {
        if (socket) {
            socket.close();
            socket = null;
        }
        sessionStorage.clear();
        showMessage(message, 'success');
        setTimeout(() => window.location.reload(), 500);
    }

    async function handleLogin(e) {
        e.preventDefault();
        const username = e.target.username.value;
        const password = e.target.password.value;
        try {
            const response = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || '로그인에 실패했습니다.');

            sessionStorage.setItem('accessToken', data.access_token);
            sessionStorage.setItem('username', username);
            sessionStorage.setItem('allowedHours', data.allowed_hours);
            showMessage('로그인 성공!', 'success');
            await updateUI();
        } catch (error) {
            showMessage(error.message, 'error');
        }
    }

    async function handleRegister(e) {
        e.preventDefault();
        const payload = {
            username: e.target.username.value,
            password: e.target.password.value,
            email: e.target.email.value,
        };
        try {
            const response = await fetch(`${API_BASE_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || '회원가입에 실패했습니다.');
            showMessage(data.message, 'success');
            registerSection.classList.add('hidden');
            loginSection.classList.remove('hidden');
            document.getElementById('login-username').value = payload.username;
        } catch (error) {
            showMessage(error.message, 'error');
        }
    }

    async function loadPlans() {
        if (cachedPlans.length > 0) return cachedPlans;
        const response = await fetch(`${API_BASE_URL}/plans`);
        cachedPlans = await response.json();
        return cachedPlans;
    }

    async function loadMe() {
        if (!sessionStorage.getItem('accessToken')) return null;
        currentMe = await fetchWithAuth('/me');
        sessionStorage.setItem('allowedHours', currentMe.subscription?.allowed_hours ?? 0);
        return currentMe;
    }

    function hideAllSections() {
        [loginSection, registerSection, planSection, pendingSection, reservationSection].forEach((el) => {
            el.classList.add('hidden');
        });
    }

    async function updateUI() {
        const token = sessionStorage.getItem('accessToken');
        if (!token) {
            hideAllSections();
            loginSection.classList.remove('hidden');
            return;
        }

        const me = await loadMe();
        hideAllSections();

        if (me.role === 'admin') {
            reservationSection.classList.remove('hidden');
            renderReservationView(me);
            return;
        }

        if (me.access_status === 'no_plan') {
            planSection.classList.remove('hidden');
            document.getElementById('plan-welcome-message').textContent = me.username;
            await renderPlanSelection('plans-container', applyForPlan);
            return;
        }

        if (me.access_status === 'pending_payment') {
            pendingSection.classList.remove('hidden');
            document.getElementById('pending-welcome-message').textContent = me.username;
            document.getElementById('pending-message').textContent = me.message;
            const billingEl = document.getElementById('pending-billing-info');
            if (me.billing) {
                billingEl.innerHTML = `
                    <p><strong>${me.billing.period}</strong> · ${me.billing.plan_name} · <strong>${formatPrice(me.billing.amount)}</strong></p>
                    <p class="sub-info">입금 확인 후 시간표를 이용할 수 있습니다.</p>
                `;
            } else {
                billingEl.innerHTML = '<p class="sub-info">관리자가 다음 달 정산을 열면 입금 안내가 표시됩니다.</p>';
            }
            await renderPlanSelection('pending-plans-container', changePlan, me.subscription?.plan_id);
            return;
        }

        if (me.can_access_schedule) {
            reservationSection.classList.remove('hidden');
            renderReservationView(me);
            return;
        }

        pendingSection.classList.remove('hidden');
        document.getElementById('pending-welcome-message').textContent = me.username;
        document.getElementById('pending-message').textContent = me.message;
    }

    function formatPrice(amount) {
        if (!amount) return '관리자 문의';
        return `${Number(amount).toLocaleString()}원`;
    }

    async function renderPlanSelection(containerId, handler, currentPlanId = null) {
        const plans = await loadPlans();
        const container = document.getElementById(containerId);
        container.innerHTML = plans.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            return `
                <div class="plan-card ${isCurrent ? 'current' : ''}">
                    <h3>${plan.name}</h3>
                    <p class="plan-hours">주 ${plan.allowed_hours}시간</p>
                    <p class="plan-price">${formatPrice(plan.monthly_price)}</p>
                    <button type="button" data-plan-id="${plan.id}" ${isCurrent ? 'disabled' : ''}>
                        ${isCurrent ? '현재 요금제' : '선택'}
                    </button>
                </div>
            `;
        }).join('');

        container.querySelectorAll('button[data-plan-id]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const planId = parseInt(btn.dataset.planId, 10);
                await handler(planId);
            });
        });
    }

    async function applyForPlan(planId) {
        try {
            const data = await fetchWithAuth('/plans/apply', {
                method: 'POST',
                body: JSON.stringify({ plan_id: planId }),
            });
            showMessage(data.message, 'success');
            await updateUI();
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    async function changePlan(planId) {
        try {
            const data = await fetchWithAuth('/plans/change', {
                method: 'POST',
                body: JSON.stringify({ plan_id: planId }),
            });
            showMessage(data.message, 'success');
            await updateUI();
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    function renderReservationView(me) {
        document.getElementById('welcome-message').textContent = me.username;
        document.getElementById('allowed-hours').textContent = me.subscription?.allowed_hours ?? sessionStorage.getItem('allowedHours');
        const subInfo = document.getElementById('subscription-info');
        if (me.subscription) {
            subInfo.textContent = `${me.subscription.plan_name} · ${formatPrice(me.subscription.monthly_price)}`;
        } else {
            subInfo.textContent = '';
        }

        loadReservationNotice();
        if (!socket) {
            socket = new WebSocket(WS_URL);
            socket.onmessage = handleSocketMessage;
        }
        generateReservationGrid();

        const changeArea = document.getElementById('plan-change-area');
        if (me.role !== 'admin' && me.access_status === 'active') {
            changeArea.classList.remove('hidden');
            renderPlanSelection('active-plans-container', changePlan, me.subscription?.plan_id);
        } else {
            changeArea.classList.add('hidden');
        }
    }

    async function handleSubmitReservation() {
        const selectedSlots = document.querySelectorAll('.time-slot.selected');
        if (selectedSlots.length === 0) {
            showMessage('예약할 시간을 선택해주세요.', 'error');
            return;
        }
        const reservationDetails = Array.from(selectedSlots).map((slot) => ({
            day: slot.dataset.day,
            time_index: parseInt(slot.dataset.timeIndex, 10),
        }));
        try {
            const data = await fetchWithAuth('/reserve', {
                method: 'POST',
                body: JSON.stringify({ reservations: reservationDetails }),
            });
            showMessage(data.message, 'success');
            selectedSlots.forEach((slot) => slot.classList.remove('selected'));
        } catch (error) {
            if (error.message !== '세션 만료') showMessage(error.message, 'error');
        }
    }

    function handleSocketMessage(event) {
        const message = JSON.parse(event.data);
        if (message.type === 'RESERVATION_UPDATE') {
            updateGridWithReservations(message.data);
        }
    }

    function loadReservationNotice() {
        const noticeDiv = document.getElementById('reservation-notice');
        fetch(`${API_BASE_URL}/settings`)
            .then((response) => response.json())
            .then((data) => {
                if (data.reservation_opens_at) {
                    const opensAt = new Date(data.reservation_opens_at);
                    const formattedTime = opensAt.toLocaleString('ko-KR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: false,
                    });
                    noticeDiv.className = 'message-success notice-banner';
                    noticeDiv.textContent = `다음 예약은 ${formattedTime}부터 가능합니다.`;
                } else if (data.reservation_enabled) {
                    noticeDiv.className = 'message-success notice-banner';
                    noticeDiv.textContent = '현재 예약이 가능합니다.';
                } else {
                    noticeDiv.className = 'message-error notice-banner';
                    noticeDiv.textContent = '현재 예약이 불가능합니다.';
                }
                noticeDiv.style.display = 'block';
            })
            .catch(() => {
                noticeDiv.style.display = 'none';
            });
    }

    function showMessage(message, type = 'info') {
        messageArea.textContent = message;
        messageArea.className = `message-${type}`;
        setTimeout(() => {
            messageArea.textContent = '';
            messageArea.className = '';
        }, 5000);
    }

    function generateReservationGrid() {
        const dayMap = {
            Monday: '월요일', Tuesday: '화요일', Wednesday: '수요일',
            Thursday: '목요일', Friday: '금요일', Saturday: '토요일', Sunday: '일요일',
        };
        const days = Object.keys(dayMap);
        let tableHTML = '<table class="reservation-table"><thead><tr><th>시간</th>';
        days.forEach((day) => { tableHTML += `<th>${dayMap[day]}</th>`; });
        tableHTML += '</tr></thead><tbody>';
        for (let time = 0; time < 24; time++) {
            tableHTML += `<tr><td class="time-header">${time}시`;
            days.forEach((day) => {
                let groupAttribute = '';
                if (time >= 0 && time <= 3) {
                    groupAttribute = `data-group="${day}-group"`;
                }
                tableHTML += `<td class="time-slot" data-day="${day}" data-time-index="${time}" ${groupAttribute}></td>`;
            });
            tableHTML += '</tr>';
        }
        tableHTML += '</tbody></table>';
        document.getElementById('reservation-grid-container').innerHTML = tableHTML;
        document.getElementById('reservation-grid-container').querySelectorAll('.time-slot').forEach((slot) => {
            slot.addEventListener('click', () => {
                if (slot.classList.contains('reserved') || slot.classList.contains('mine')) return;
                const group = slot.dataset.group;
                if (group) {
                    const isSelected = slot.classList.contains('selected');
                    document.querySelectorAll(`.time-slot[data-group="${group}"]`).forEach((groupSlot) => {
                        if (groupSlot.classList.contains('reserved') || groupSlot.classList.contains('mine')) return;
                        if (isSelected) groupSlot.classList.remove('selected');
                        else groupSlot.classList.add('selected');
                    });
                } else {
                    slot.classList.toggle('selected');
                }
            });
        });
    }

    function updateGridWithReservations(reservations) {
        const selectedSlotsBeforeUpdate = new Set();
        document.querySelectorAll('.time-slot.selected').forEach((slot) => {
            selectedSlotsBeforeUpdate.add(`${slot.dataset.day}-${slot.dataset.timeIndex}`);
        });
        const currentUser = sessionStorage.getItem('username');
        document.querySelectorAll('.time-slot').forEach((slot) => {
            slot.textContent = '';
            slot.classList.remove('reserved', 'mine', 'selected');
        });
        reservations.forEach((res) => {
            const slot = document.querySelector(`td[data-day="${res.reservation_day}"][data-time-index="${res.time_index}"]`);
            if (slot) {
                slot.textContent = res.username;
                if (res.username === currentUser) slot.classList.add('mine');
                else slot.classList.add('reserved');
            }
        });
        selectedSlotsBeforeUpdate.forEach((uniqueId) => {
            const [day, timeIndex] = uniqueId.split('-');
            const slot = document.querySelector(`td[data-day="${day}"][data-time-index="${timeIndex}"]`);
            if (slot && !slot.classList.contains('reserved') && !slot.classList.contains('mine')) {
                slot.classList.add('selected');
            }
        });
    }
});
