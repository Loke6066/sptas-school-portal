document.addEventListener("DOMContentLoaded", function () {
    // ============================================================
    // CLASS LIST (shared constant)
    // ============================================================
    const CLASS_LIST = ['0', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

    function buildClassOptions(includeAll = false, includeCustom = false) {
        let html = includeAll ? '<option value="">All Classes</option>' : '<option value="">Select Class</option>';
        CLASS_LIST.forEach(c => {
            const label = ['Nursery','LKG','UKG'].includes(c) ? c : (c === '0' ? 'Class 0 (Kindergarten)' : `Class ${c}`);
            html += `<option value="${c}">${label}</option>`;
        });
        if (includeCustom) html += `<option value="custom">+ Add Custom Class</option>`;
        return html;
    }

    function populateAllClassSelects() {
        document.querySelectorAll('[data-class-select="all"]').forEach(sel => { sel.innerHTML = buildClassOptions(true, false); });
        document.querySelectorAll('[data-class-select="basic"]').forEach(sel => { sel.innerHTML = buildClassOptions(false, false); });
        document.querySelectorAll('[data-class-select="custom"]').forEach(sel => { sel.innerHTML = buildClassOptions(false, true); });
    }

    // Manually populate all class selects
    const classSelectIds = ['filter-class','att-class-filter','tt-class-select','report-class','tf-class-pick','excel-dl-class','excel-rep-class','excel-reg-dl-class'];
    classSelectIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const isAll = ['filter-class','report-class','excel-rep-class'].includes(id);
        el.innerHTML = buildClassOptions(isAll, id === 'tf-class-pick');
    });
    const formClass = document.getElementById('form-class');
    if (formClass) formClass.innerHTML = buildClassOptions(false, false);


    // Meeting class checkboxes
    function buildMeetingCheckboxes() {
        const grid = document.getElementById('mtg-class-checkboxes');
        if (!grid) return;
        grid.innerHTML = CLASS_LIST.map(c => {
            const label = ['Nursery','LKG','UKG'].includes(c) ? c : (c === '0' ? 'Class 0' : `Class ${c}`);
            return ['A','B','C','D'].map(sec =>
                `<label class="checkbox-label">
                    <input type="checkbox" name="mtg-class" value="${c}-${sec}"> ${label}-${sec}
                </label>`
            ).join('');
        }).join('');
    }
    buildMeetingCheckboxes();

    // ============================================================
    // STATE
    // ============================================================
    let activeStudentObject = null;
    let activeModalStudent = null;
    let currentStudentId = null;
    let currentRole = null;
    let liveTickerInterval = null;
    let pendingDeleteId = null;
    let pendingDeleteType = null;
    let pendingPasswordRole = null;
    let currentTimetableData = {};
    let currentTimetableKey = '';
    let currentEditingDay = 'Monday';
    let teachersCache = [];

    let academicChartInstance = null;
    let radarChartInstance = null;
    let overviewRadarChartInstance = null;

    const authView = document.getElementById('auth-view');
    const appNavHeader = document.getElementById('app-nav-header');
    const adminView = document.getElementById('admin-dashboard-view');
    const reportView = document.getElementById('dashboard-report-page');
    const userGreetingLabel = document.getElementById('user-greeting-label');
    const loginErrorMsg = document.getElementById('login-error-msg');

    lucide.createIcons();

    const today = new Date();
    document.querySelectorAll('.current-date-str').forEach(el =>
        el.textContent = today.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
    const attDateFilter = document.getElementById('att-date-filter');
    if (attDateFilter) attDateFilter.value = today.toISOString().slice(0,10);
    const reportMonth = document.getElementById('report-month');
    if (reportMonth) reportMonth.value = today.toISOString().slice(0,7);

    // ============================================================
    // SHOW/HIDE PASSWORD
    // ============================================================
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('.show-pwd-btn');
        if (!btn) return;
        const input = document.getElementById(btn.getAttribute('data-target'));
        if (!input) return;
        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon?.setAttribute('data-lucide','eye-off');
        } else {
            input.type = 'password';
            icon?.setAttribute('data-lucide','eye');
        }
        lucide.createIcons();
    });

    // ============================================================
    // HELPERS
    // ============================================================
    function cleanPhone(p) { return (p||'').replace(/[\s\-+]/g,'').replace(/^91/,''); }
    function validatePhone(p) { const c=cleanPhone(p); return c.length>0 && c.length<=10 && /^\d+$/.test(c); }
    function setEl(id, txt) { const e=document.getElementById(id); if(e) e.textContent=txt; }
    function formatDate(d) {
        if (!d) return '—';
        try { return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}); }
        catch { return d; }
    }
    function debounce(fn, ms) { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
    function showToast(msg, type='success') {
        let t = document.getElementById('sptas-toast');
        if (t) t.remove();
        t = document.createElement('div');
        t.id = 'sptas-toast';
        t.className = `sptas-toast toast-${type}`;
        t.innerHTML = `<i data-lucide="${type==='success'?'check-circle':'alert-circle'}"></i> ${msg}`;
        document.body.appendChild(t);
        lucide.createIcons();
        setTimeout(()=>t.classList.add('toast-visible'),50);
        setTimeout(()=>{ t.classList.remove('toast-visible'); setTimeout(()=>t.remove(),400); },3500);
    }
    window.showToast = showToast;

    function showModal(id) { const m=document.getElementById(id); if(m){ m.classList.remove('hidden'); lucide.createIcons(); } }
    function hideModal(id) { const m=document.getElementById(id); if(m) m.classList.add('hidden'); }

    function showLoginError(msg) {
        loginErrorMsg.textContent = msg;
        loginErrorMsg.classList.remove('hidden');
    }

    // ============================================================
    // THEME
    // ============================================================
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('sptas_theme', theme);
        document.querySelector('.theme-icon-dark')?.classList.toggle('hidden', theme==='dark');
        document.querySelector('.theme-icon-light')?.classList.toggle('hidden', theme==='light');
    }
    applyTheme(localStorage.getItem('sptas_theme')||'light');
    document.getElementById('theme-toggle-btn')?.addEventListener('click', ()=>
        applyTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light'));

    // ============================================================
    // AUTH SESSION
    // ============================================================
    function checkAuthSession() {
        const role = localStorage.getItem('sptas_role');
        currentRole = role;
        if (!role) { showAuthView(); return; }
        const name = localStorage.getItem('sptas_user_name');
        authView.classList.add('hidden');
        appNavHeader.classList.remove('hidden');
        userGreetingLabel.textContent = `Logged in as: ${name||role}`;
        if (role==='parent') loadParentDashboard(localStorage.getItem('sptas_student_id'));
        else loadAdminDashboard();
    }

    function showAuthView() {
        authView.classList.remove('hidden');
        appNavHeader.classList.add('hidden');
        adminView.classList.add('hidden');
        reportView.classList.add('hidden');
    }

    checkAuthSession();

    // ============================================================
    // AUTH TABS
    // ============================================================
    document.querySelectorAll('.auth-tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.auth-tab-btn').forEach(b=>b.classList.remove('active'));
            document.querySelectorAll('.login-form').forEach(f=>f.classList.add('hidden'));
            btn.classList.add('active');
            loginErrorMsg.classList.add('hidden');
            document.getElementById(`${btn.dataset.role}-login-form`)?.classList.remove('hidden');
        });
    });

    // ============================================================
    // PARENT LOGIN
    // ============================================================
    document.getElementById('parent-login-btn')?.addEventListener('click', async function() {
        loginErrorMsg.classList.add('hidden');
        const roll = document.getElementById('parent-roll').value.trim();
        const phone = document.getElementById('parent-phone').value.trim();
        const pwd = document.getElementById('parent-pass').value.trim();
        if (!roll || !phone) { showLoginError('Roll number and phone are required.'); return; }
        if (!validatePhone(phone)) { showLoginError('Phone must be 10 digits or less.'); return; }
        const res = await fetch('/api/login',{ method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({role:'parent', roll_no:roll, phone_no:phone, password:pwd}) });
        const data = await res.json();
        if (data.success) {
            currentRole = 'parent';
            localStorage.setItem('sptas_role','parent');
            localStorage.setItem('sptas_student_id', data.student_id);
            localStorage.setItem('sptas_user_name', data.name);
            if (data.require_password_setup) {
                pendingPasswordRole = {role:'parent', entityId:data.student_id, name:data.name};
                showPasswordSetup('parent');
            } else {
                proceedToPortal('parent', data.name);
                loadParentDashboard(data.student_id);
            }
        } else { showLoginError(data.message||'Login failed.'); }
    });

    // ============================================================
    // TEACHER LOGIN
    // ============================================================
    document.getElementById('teacher-login-btn')?.addEventListener('click', async function() {
        loginErrorMsg.classList.add('hidden');
        const phone = document.getElementById('teacher-phone').value.trim();
        const pwd = document.getElementById('teacher-password').value.trim();
        if (!phone) { showLoginError('Phone number is required.'); return; }
        if (!validatePhone(phone)) { showLoginError('Phone must be 10 digits or less.'); return; }
        const res = await fetch('/api/login',{ method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({role:'teacher', phone, password:pwd}) });
        const data = await res.json();
        if (data.success) {
            currentRole = 'teacher';
            localStorage.setItem('sptas_role','teacher');
            localStorage.setItem('sptas_teacher_id', data.teacher_id);
            localStorage.setItem('sptas_user_name', data.name);
            if (data.require_password_setup) {
                pendingPasswordRole = {role:'teacher', entityId:data.teacher_id, name:data.name};
                showPasswordSetup('teacher');
            } else {
                proceedToPortal('teacher', data.name);
            }
        } else { showLoginError(data.message||'Login failed.'); }
    });

    // ============================================================
    // PRINCIPAL LOGIN
    // ============================================================
    document.getElementById('principal-login-btn')?.addEventListener('click', async function() {
        loginErrorMsg.classList.add('hidden');
        const username = document.getElementById('principal-username').value.trim();
        const password = document.getElementById('principal-password').value.trim();
        const res = await fetch('/api/login',{ method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({role:'principal', username, password}) });
        const data = await res.json();
        if (data.success) {
            currentRole = 'principal';
            localStorage.setItem('sptas_role','principal');
            localStorage.setItem('sptas_user_name', data.name);
            proceedToPortal('principal', data.name);
        } else { showLoginError(data.message||'Invalid credentials.'); }
    });

    function proceedToPortal(role, name) {
        authView.classList.add('hidden');
        appNavHeader.classList.remove('hidden');
        userGreetingLabel.textContent = `Logged in as: ${name}`;
        const isPrincipal = role === 'principal';
        document.getElementById('edit-principal-name-btn')?.classList.toggle('hidden', !isPrincipal);
        document.querySelectorAll('.principal-only').forEach(el=>el.classList.toggle('hidden', !isPrincipal));
        if (role !== 'parent') loadAdminDashboard();
    }

    // ============================================================
    // FORGOT PASSWORD
    // ============================================================
    document.querySelectorAll('.forgot-pwd-link').forEach(btn => {
        btn.addEventListener('click', function() {
            document.getElementById('forgot-pwd-role').value = btn.dataset.role;
            document.getElementById('otp-phone').value = '';
            document.getElementById('otp-code-input').value = '';
            document.getElementById('otp-new-pwd').value = '';
            document.getElementById('otp-step-1').classList.remove('hidden');
            document.getElementById('otp-step-2').classList.add('hidden');
            document.getElementById('otp-demo-banner').classList.add('hidden');
            document.getElementById('otp-step1-error').classList.add('hidden');
            document.getElementById('otp-step2-error').classList.add('hidden');
            showModal('forgot-pwd-overlay');
        });
    });

    document.getElementById('forgot-pwd-close')?.addEventListener('click', ()=>hideModal('forgot-pwd-overlay'));

    document.getElementById('send-otp-btn')?.addEventListener('click', async function() {
        const phone = document.getElementById('otp-phone').value.trim();
        const role = document.getElementById('forgot-pwd-role').value;
        const errEl = document.getElementById('otp-step1-error');
        if (!phone) { errEl.textContent='Enter phone number.'; errEl.classList.remove('hidden'); return; }
        const res = await fetch('/api/otp/send',{ method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({phone: cleanPhone(phone), role}) });
        const data = await res.json();
        if (data.success) {
            document.getElementById('otp-demo-code').textContent = data.otp_demo;
            document.getElementById('otp-demo-banner').classList.remove('hidden');
            errEl.classList.add('hidden');
            setTimeout(()=>{
                document.getElementById('otp-step-1').classList.add('hidden');
                document.getElementById('otp-step-2').classList.remove('hidden');
            },2000);
        } else { errEl.textContent=data.message||'Error.'; errEl.classList.remove('hidden'); }
    });

    document.getElementById('otp-back-btn')?.addEventListener('click', ()=>{
        document.getElementById('otp-step-1').classList.remove('hidden');
        document.getElementById('otp-step-2').classList.add('hidden');
    });

    document.getElementById('reset-pwd-btn')?.addEventListener('click', async function() {
        const phone = document.getElementById('otp-phone').value.trim();
        const otp = document.getElementById('otp-code-input').value.trim();
        const newPwd = document.getElementById('otp-new-pwd').value.trim();
        const role = document.getElementById('forgot-pwd-role').value;
        const errEl = document.getElementById('otp-step2-error');
        if (!otp||!newPwd) { errEl.textContent='Enter OTP and new password.'; errEl.classList.remove('hidden'); return; }
        // Verify OTP
        const vRes = await fetch('/api/otp/verify',{ method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({phone:cleanPhone(phone), otp}) });
        const vData = await vRes.json();
        if (!vData.success) { errEl.textContent='Invalid OTP.'; errEl.classList.remove('hidden'); return; }
        // Reset password
        const rRes = await fetch('/api/reset-password',{ method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({phone:cleanPhone(phone), password:newPwd, role}) });
        const rData = await rRes.json();
        if (rData.success) {
            hideModal('forgot-pwd-overlay');
            showToast('Password reset successfully! Please login.','success');
        } else { errEl.textContent=rData.message||'Reset failed.'; errEl.classList.remove('hidden'); }
    });

    // ============================================================
    // PASSWORD SETUP MODAL
    // ============================================================
    function showPasswordSetup(role) {
        document.getElementById('pwd-setup-title').textContent = role==='teacher'?'Set Teacher Password':'Set Parent Password';
        document.getElementById('pwd-setup-input').value='';
        document.getElementById('pwd-setup-confirm').value='';
        document.getElementById('pwd-setup-error').classList.add('hidden');
        showModal('password-setup-overlay');
    }

    document.getElementById('pwd-setup-save-btn')?.addEventListener('click', async function() {
        const newPwd = document.getElementById('pwd-setup-input').value.trim();
        const confirm = document.getElementById('pwd-setup-confirm').value.trim();
        const errEl = document.getElementById('pwd-setup-error');
        if (!newPwd) { errEl.textContent='Password cannot be empty.'; errEl.classList.remove('hidden'); return; }
        if (newPwd!==confirm) { errEl.textContent='Passwords do not match.'; errEl.classList.remove('hidden'); return; }
        const {role, entityId, name} = pendingPasswordRole;
        const url = role==='teacher'?'/api/teacher/set-password':'/api/parent/set-password';
        const body = role==='teacher'?{teacher_id:entityId, password:newPwd}:{student_id:entityId, password:newPwd};
        const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const data = await res.json();
        if (data.success) {
            hideModal('password-setup-overlay');
            showToast('Password set successfully!','success');
            proceedToPortal(role, name);
            if (role==='parent') loadParentDashboard(entityId);
        } else { errEl.textContent=data.message||'Error.'; errEl.classList.remove('hidden'); }
    });

    // ============================================================
    // EDIT PRINCIPAL NAME
    // ============================================================
    document.getElementById('edit-principal-name-btn')?.addEventListener('click', ()=>{
        document.getElementById('edit-principal-name-input').value = localStorage.getItem('sptas_user_name')||'';
        showModal('edit-name-overlay');
    });
    document.getElementById('edit-name-close')?.addEventListener('click', ()=>hideModal('edit-name-overlay'));
    document.getElementById('edit-name-cancel')?.addEventListener('click', ()=>hideModal('edit-name-overlay'));
    document.getElementById('edit-name-save')?.addEventListener('click', async function() {
        const name = document.getElementById('edit-principal-name-input').value.trim();
        if (!name) return;
        const res = await fetch('/api/settings/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({principal_name:name})});
        const data = await res.json();
        if (data.success) {
            localStorage.setItem('sptas_user_name',name);
            userGreetingLabel.textContent=`Logged in as: ${name}`;
            hideModal('edit-name-overlay');
            showToast('Name updated.','success');
        }
    });

    // ============================================================
    // LOGOUT
    // ============================================================
    document.getElementById('logout-btn')?.addEventListener('click', function() {
        if (liveTickerInterval) clearInterval(liveTickerInterval);
        ['sptas_role','sptas_student_id','sptas_user_name','sptas_teacher_id'].forEach(k=>localStorage.removeItem(k));
        currentRole=null;
        showAuthView();
        loginErrorMsg.classList.add('hidden');
    });

    // ============================================================
    // ADMIN DASHBOARD
    // ============================================================
    async function loadAdminDashboard() {
        if (liveTickerInterval) clearInterval(liveTickerInterval);
        reportView.classList.add('hidden');
        adminView.classList.remove('hidden');
        const isPrincipal = currentRole==='principal';
        document.getElementById('edit-principal-name-btn')?.classList.toggle('hidden',!isPrincipal);
        document.querySelectorAll('.principal-only').forEach(el=>el.classList.toggle('hidden',!isPrincipal));

        // Load settings for school name
        try {
            const sRes = await fetch('/api/settings');
            const s = await sRes.json();
            if (s.school_name) {
                document.getElementById('auth-school-name')&&(document.getElementById('auth-school-name').textContent=s.school_name);
                document.getElementById('header-school-name')&&(document.getElementById('header-school-name').textContent=s.school_name.split(' ').slice(0,2).join(' '));
            }
        } catch {}

        try {
            const res = await fetch('/api/stats');
            const stats = await res.json();
            setEl('admin-stat-students',stats.total_students);
            setEl('admin-stat-attendance',stats.overall_attendance);
            setEl('admin-stat-classes',stats.active_classes);
            setEl('admin-stat-teachers',stats.teachers);
        } catch {}

        // Fetch teachers for cache
        try {
            const tr = await fetch('/api/teachers');
            teachersCache = await tr.json();
        } catch { teachersCache=[]; }

        loadStudentTable();
        lucide.createIcons();
    }

    // ============================================================
    // ADMIN PORTAL TABS
    // ============================================================
    document.querySelectorAll('.admin-tab-pill').forEach(btn=>{
        btn.addEventListener('click',function(){
            document.querySelectorAll('.admin-tab-pill').forEach(b=>b.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.add('hidden'));
            btn.classList.add('active');
            const tabId = btn.dataset.adminTab;
            document.getElementById(tabId)?.classList.remove('hidden');
            if (tabId==='tab-teachers') loadTeachersTable();
            if (tabId==='tab-meetings') loadMeetingsAdmin();
        });
    });

    // ============================================================
    // STUDENT TABLE
    // ============================================================
    async function loadStudentTable(q='', cls='', sec='') {
        let url=`/api/search?q=${encodeURIComponent(q)}`;
        if(cls) url+=`&class=${cls}`;
        if(sec) url+=`&section=${sec}`;
        const res = await fetch(url);
        const students = await res.json();
        const tbody = document.querySelector('#admin-students-table tbody');
        const badge = document.getElementById('students-count-badge');
        badge.textContent = `${students.length} Student${students.length!==1?'s':''}`;
        tbody.innerHTML='';
        if (!students.length) {
            tbody.innerHTML=`<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>`;
            return;
        }
        students.forEach(s=>{
            const attBadge = s.attendance_status==='Absent'
                ?`<span class="badge badge-danger">Absent</span>`
                :`<span class="badge badge-success">Present</span>`;
            const trendBadge = s.trend==='Improving'
                ?`<span class="badge badge-success">↑ Improving</span>`
                :s.trend==='Declining'
                ?`<span class="badge badge-danger">↓ Declining</span>`
                :`<span class="badge badge-info">→ Stable</span>`;
            const fbBadge = s.parent_feedback
                ?`<span class="badge badge-warning">Has Feedback</span>`
                :`<span style="color:var(--text-muted);font-size:0.78rem;">None</span>`;
            const tr = document.createElement('tr');
            tr.innerHTML=`
                <td><strong>${s.roll_no}</strong></td>
                <td>${s.name}</td>
                <td style="font-size:0.8rem;">${s.admission_no||'—'}</td>
                <td><span class="badge badge-info">${s.class}-${s.section}</span></td>
                <td>${attBadge}<br><small style="color:var(--text-muted);">${s.attendance}%</small></td>
                <td>${trendBadge}</td>
                <td style="font-size:0.8rem;">${s.parent_name||'—'}<br><small>${s.parent_contact||''}</small></td>
                <td>${fbBadge}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn-action btn-view" onclick="viewStudent('${s.id}')" title="View"><i data-lucide="eye"></i></button>
                        <button class="btn-action btn-edit" onclick="editStudentById('${s.id}')" title="Edit"><i data-lucide="pencil"></i></button>
                        <button class="btn-action btn-delete" onclick="requestDeleteStudent('${s.id}','${s.name.replace(/'/g,'')}')" title="Delete"><i data-lucide="trash-2"></i></button>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    }

    const adminSearch = document.getElementById('admin-search-input');
    adminSearch?.addEventListener('input', debounce(()=>{
        loadStudentTable(adminSearch.value.trim(),
            document.getElementById('filter-class')?.value||'',
            document.getElementById('filter-section')?.value||'');
    },350));
    document.getElementById('filter-class')?.addEventListener('change',function(){
        loadStudentTable(adminSearch?.value.trim()||'',this.value,document.getElementById('filter-section')?.value||'');
    });
    document.getElementById('filter-section')?.addEventListener('change',function(){
        loadStudentTable(adminSearch?.value.trim()||'',document.getElementById('filter-class')?.value||'',this.value);
    });

    // ============================================================
    // DELETE CONFIRM MODAL
    // ============================================================
    window.requestDeleteStudent = function(id,name) {
        pendingDeleteId=id; pendingDeleteType='student';
        setEl('confirm-delete-title','Delete Student?');
        setEl('confirm-delete-msg',`Are you sure you want to permanently delete "${name}"? This cannot be undone.`);
        showModal('confirm-delete-overlay');
    };
    window.requestDeleteTeacher = function(id,name) {
        pendingDeleteId=id; pendingDeleteType='teacher';
        setEl('confirm-delete-title','Delete Teacher?');
        setEl('confirm-delete-msg',`Remove "${name}" from staff? This cannot be undone.`);
        showModal('confirm-delete-overlay');
    };
    document.getElementById('confirm-delete-cancel')?.addEventListener('click',()=>hideModal('confirm-delete-overlay'));
    document.getElementById('confirm-delete-ok')?.addEventListener('click', async function() {
        hideModal('confirm-delete-overlay');
        if (pendingDeleteType==='student') {
            const res = await fetch(`/api/admin/student/delete/${pendingDeleteId}`,{method:'POST'});
            const d = await res.json();
            if(d.success){showToast('Student deleted.','success');loadStudentTable();}
            else showToast(d.message||'Error.','error');
        } else if (pendingDeleteType==='teacher') {
            const res = await fetch(`/api/teacher/delete/${pendingDeleteId}`,{method:'POST'});
            const d = await res.json();
            if(d.success){showToast('Teacher removed.','success');loadTeachersTable();}
            else showToast(d.message||'Error.','error');
        }
        pendingDeleteId=null; pendingDeleteType=null;
    });

    // ============================================================
    // ADD / EDIT STUDENT MODAL
    // ============================================================
    document.getElementById('admin-add-student-btn')?.addEventListener('click', ()=>openStudentModal(null));

    window.editStudentById = async function(id) {
        const res = await fetch(`/api/student/${id}`);
        const s = await res.json();
        if (!s.error) openStudentModal(s);
    };

    function openStudentModal(student) {
        activeModalStudent = student;
        document.getElementById('modal-title').textContent = student?'Edit Student Record':'Add New Student';
        // Basic Info
        document.getElementById('form-student-name').value = student?.name||'';
        document.getElementById('form-roll-no').value = student?.roll_no||'';
        document.getElementById('form-admission-no').value = student?.admission_no||'';
        document.getElementById('form-dob').value = student?.dob||'';
        document.getElementById('form-class').value = student?.class||'10';
        document.getElementById('form-section').value = student?.section||'A';
        document.getElementById('form-academic-year').value = student?.academic_year||'2025-26';
        document.getElementById('form-parent-name').value = student?.parent_name||'';
        document.getElementById('form-parent-contact').value = student?.parent_contact||'';
        document.getElementById('form-parent-alt-contact').value = student?.parent_alt_contact||'';
        document.getElementById('form-class-teacher').value = student?.current_status?.class_teacher||'';
        document.getElementById('form-attendance-pct').value = student?.current_status?.attendance_percentage||90;
        document.getElementById('form-performance-trend').value = student?.performance_trend||'Stable';
        document.getElementById('form-attendance-status').value = student?.attendance_status||'Present';
        // Behavior
        const beh = student?.behavioral_observation||{};
        ['discipline','leadership','participation','communication','teamwork','confidence'].forEach(k=>{
            const el = document.getElementById(`form-beh-${k}`);
            if(el) el.value = beh[k]||4;
        });
        // Remarks editor
        renderRemarksEditor(student?.teacher_term_remarks||[]);
        // Activities / Awards editors
        renderActivitiesEditor(student?.co_curricular_activities||[]);
        renderAwardsEditor(student?.awards||[]);
        // Exam section
        loadModalExamSection(student);
        // Timetable
        renderModalTimetableDay('Monday');
        // Reset tabs
        document.querySelectorAll('.modal-tab-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
        document.querySelectorAll('.modal-tab-content').forEach((c,i)=>c.classList.toggle('hidden',i!==0));
        showModal('student-modal');
    }

    document.getElementById('close-student-modal')?.addEventListener('click',()=>hideModal('student-modal'));
    document.getElementById('cancel-student-modal-btn')?.addEventListener('click',()=>hideModal('student-modal'));

    // Modal Tab switching
    document.querySelectorAll('.modal-tab-btn').forEach(btn=>{
        btn.addEventListener('click',function(){
            document.querySelectorAll('.modal-tab-btn').forEach(b=>b.classList.remove('active'));
            document.querySelectorAll('.modal-tab-content').forEach(c=>c.classList.add('hidden'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.modalTab)?.classList.remove('hidden');
        });
    });

    // REMARKS EDITOR
    function renderRemarksEditor(remarks) {
        const el = document.getElementById('remarks-list-editor');
        if (!el) return;
        el.innerHTML = remarks.map((r,i)=>`
            <div class="inline-editor-row" data-index="${i}">
                <input type="text" class="form-input remark-teacher" value="${r.teacher_name||''}" placeholder="Teacher name" style="flex:1;">
                <input type="text" class="form-input remark-subject" value="${r.subject||''}" placeholder="Subject" style="flex:1;">
                <input type="text" class="form-input remark-text" value="${r.remark||''}" placeholder="Remark text" style="flex:2;">
                <input type="date" class="form-input remark-date" value="${r.date||''}" style="width:130px;">
                <button type="button" class="btn-action btn-delete" onclick="this.closest('.inline-editor-row').remove()"><i data-lucide="trash-2"></i></button>
            </div>`).join('');
        lucide.createIcons();
    }
    document.getElementById('add-remark-btn')?.addEventListener('click',()=>{
        const c = document.getElementById('remarks-list-editor');
        const d = document.createElement('div');
        d.className='inline-editor-row';
        d.innerHTML=`<input type="text" class="form-input remark-teacher" placeholder="Teacher name" style="flex:1;">
            <input type="text" class="form-input remark-subject" placeholder="Subject" style="flex:1;">
            <input type="text" class="form-input remark-text" placeholder="Remark text" style="flex:2;">
            <input type="date" class="form-input remark-date" style="width:130px;">
            <button type="button" class="btn-action btn-delete" onclick="this.closest('.inline-editor-row').remove()"><i data-lucide="trash-2"></i></button>`;
        c?.appendChild(d); lucide.createIcons();
    });

    function getRemarks() {
        const rows=[]; document.querySelectorAll('.inline-editor-row').forEach(row=>{
            const t=row.querySelector('.remark-teacher')?.value.trim()||'';
            const s=row.querySelector('.remark-subject')?.value.trim()||'';
            const r=row.querySelector('.remark-text')?.value.trim()||'';
            const d=row.querySelector('.remark-date')?.value||'';
            if(r) rows.push({teacher_name:t,subject:s,remark:r,date:d});
        }); return rows;
    }

    // ACTIVITIES EDITOR
    function renderActivitiesEditor(acts) {
        const el=document.getElementById('activities-editor'); if(!el) return;
        el.innerHTML=acts.map((a,i)=>`
            <div class="inline-editor-row">
                <input type="text" class="form-input act-name" value="${a.name||a}" placeholder="Activity name" style="flex:2;">
                <input type="text" class="form-input act-date" value="${a.date||''}" placeholder="Date" style="flex:1;">
                <input type="text" class="form-input act-desc" value="${a.description||''}" placeholder="Description" style="flex:2;">
                <button type="button" class="btn-action btn-delete" onclick="this.closest('.inline-editor-row').remove()"><i data-lucide="trash-2"></i></button>
            </div>`).join('');
        lucide.createIcons();
    }
    document.getElementById('add-activity-btn')?.addEventListener('click',()=>{
        const c=document.getElementById('activities-editor');
        const d=document.createElement('div'); d.className='inline-editor-row';
        d.innerHTML=`<input type="text" class="form-input act-name" placeholder="Activity name" style="flex:2;">
            <input type="text" class="form-input act-date" placeholder="Date" style="flex:1;">
            <input type="text" class="form-input act-desc" placeholder="Description" style="flex:2;">
            <button type="button" class="btn-action btn-delete" onclick="this.closest('.inline-editor-row').remove()"><i data-lucide="trash-2"></i></button>`;
        c?.appendChild(d); lucide.createIcons();
    });
    function getActivities() {
        const rows=[]; document.querySelectorAll('#activities-editor .inline-editor-row').forEach(row=>{
            const n=row.querySelector('.act-name')?.value.trim();
            if(n) rows.push({name:n, date:row.querySelector('.act-date')?.value||'', description:row.querySelector('.act-desc')?.value.trim()||''});
        }); return rows;
    }

    // AWARDS EDITOR
    function renderAwardsEditor(awards) {
        const el=document.getElementById('awards-editor'); if(!el) return;
        el.innerHTML=awards.map(a=>`
            <div class="inline-editor-row">
                <input type="text" class="form-input award-title" value="${a.title||a}" placeholder="Award title" style="flex:2;">
                <input type="text" class="form-input award-date" value="${a.date||''}" placeholder="Date" style="flex:1;">
                <input type="text" class="form-input award-desc" value="${a.description||''}" placeholder="Description" style="flex:2;">
                <button type="button" class="btn-action btn-delete" onclick="this.closest('.inline-editor-row').remove()"><i data-lucide="trash-2"></i></button>
            </div>`).join('');
        lucide.createIcons();
    }
    document.getElementById('add-award-btn')?.addEventListener('click',()=>{
        const c=document.getElementById('awards-editor');
        const d=document.createElement('div'); d.className='inline-editor-row';
        d.innerHTML=`<input type="text" class="form-input award-title" placeholder="Award title" style="flex:2;">
            <input type="text" class="form-input award-date" placeholder="Date" style="flex:1;">
            <input type="text" class="form-input award-desc" placeholder="Description" style="flex:2;">
            <button type="button" class="btn-action btn-delete" onclick="this.closest('.inline-editor-row').remove()"><i data-lucide="trash-2"></i></button>`;
        c?.appendChild(d); lucide.createIcons();
    });
    function getAwards() {
        const rows=[]; document.querySelectorAll('#awards-editor .inline-editor-row').forEach(row=>{
            const t=row.querySelector('.award-title')?.value.trim();
            if(t) rows.push({title:t, date:row.querySelector('.award-date')?.value||'', description:row.querySelector('.award-desc')?.value.trim()||''});
        }); return rows;
    }

    // EXAM SECTION
    function loadModalExamSection(student) {
        const prog=student?.examination_progress||[];
        const latest=prog[prog.length-1];
        document.getElementById('modal-exam-name').value=latest?.exam_name||latest?.exam||'';
        document.getElementById('modal-exam-year').value=latest?.year||new Date().getFullYear();
        document.getElementById('modal-exam-rows').innerHTML='';
        (latest?.subjects||[]).forEach(sub=>addExamRow(sub.name,sub.obtained,sub.max));
        updateExamTotals();
    }
    document.getElementById('modal-add-subject-row')?.addEventListener('click',()=>addExamRow());
    function addExamRow(name='',obt=0,max=100) {
        const c=document.getElementById('modal-exam-rows');
        const row=document.createElement('tr');
        row.innerHTML=`<td><input type="text" class="form-input exam-sub-name" value="${name}" placeholder="Subject" style="min-width:100px;"></td>
            <td><input type="number" class="form-input exam-obtained" value="${obt}" min="0" max="999" style="width:75px;" oninput="updateExamTotals()"></td>
            <td><input type="number" class="form-input exam-max" value="${max}" min="0" max="999" style="width:75px;" oninput="updateExamTotals()"></td>
            <td><button type="button" class="btn-action btn-delete" onclick="this.closest('tr').remove();updateExamTotals()"><i data-lucide="trash-2"></i></button></td>`;
        c?.appendChild(row); lucide.createIcons();
    }
    window.updateExamTotals = function() {
        let tot=0,max=0;
        document.querySelectorAll('#modal-exam-rows tr').forEach(r=>{
            tot+=parseInt(r.querySelector('.exam-obtained')?.value||0);
            max+=parseInt(r.querySelector('.exam-max')?.value||0);
        });
        setEl('modal-exam-total-obtained',tot);
        setEl('modal-exam-total-max',max);
        const pct=max>0?((tot/max)*100).toFixed(1):0;
        setEl('modal-exam-percentage',`${pct}%`);
        setEl('modal-exam-passfail',max>0&&pct>=33?'✅ PASS':'❌ FAIL');
    };
    document.getElementById('modal-exam-save-btn')?.addEventListener('click',async function(){
        if(!activeModalStudent) return;
        const examName=document.getElementById('modal-exam-name')?.value.trim();
        const examYear=document.getElementById('modal-exam-year')?.value.trim();
        const subjects=[];
        document.querySelectorAll('#modal-exam-rows tr').forEach(r=>{
            const n=r.querySelector('.exam-sub-name')?.value.trim();
            if(n) subjects.push({name:n,obtained:parseInt(r.querySelector('.exam-obtained')?.value||0),max:parseInt(r.querySelector('.exam-max')?.value||100)});
        });
        const existing=activeModalStudent.examination_progress||[];
        const idx=existing.findIndex(e=>(e.exam_name||e.exam)===examName);
        const entry={exam_name:examName,exam:examName,year:examYear,subjects};
        if(idx>=0) existing[idx]=entry; else existing.push(entry);
        const res=await fetch(`/api/admin/student/update/${activeModalStudent.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...activeModalStudent,examination_progress:existing})});
        const d=await res.json();
        if(d.success){showToast('Exam saved.','success');activeModalStudent.examination_progress=existing;}
        else showToast('Error.','error');
    });

    // STUDENT FORM SUBMIT
    document.getElementById('student-form')?.addEventListener('submit', async function(e) {
        e.preventDefault();
        const pc=document.getElementById('form-parent-contact').value.trim();
        if(!validatePhone(pc)){showToast('Parent phone must be 10 digits.','error');return;}
        const alt=document.getElementById('form-parent-alt-contact').value.trim();
        if(alt&&!validatePhone(alt)){showToast('Alt phone must be 10 digits.','error');return;}
        const body={
            name:document.getElementById('form-student-name').value.trim(),
            roll_no:document.getElementById('form-roll-no').value.trim(),
            admission_no:document.getElementById('form-admission-no').value.trim(),
            dob:document.getElementById('form-dob').value,
            class:document.getElementById('form-class').value,
            section:document.getElementById('form-section').value,
            academic_year:document.getElementById('form-academic-year').value,
            parent_name:document.getElementById('form-parent-name').value.trim(),
            parent_contact:cleanPhone(pc),
            parent_alt_contact:alt?cleanPhone(alt):'',
            class_teacher:document.getElementById('form-class-teacher').value.trim(),
            attendance_percentage:parseFloat(document.getElementById('form-attendance-pct').value)||90,
            performance_trend:document.getElementById('form-performance-trend').value,
            attendance_status:document.getElementById('form-attendance-status').value,
            behavioral_observation:{
                discipline:parseInt(document.getElementById('form-beh-discipline').value)||4,
                leadership:parseInt(document.getElementById('form-beh-leadership').value)||4,
                participation:parseInt(document.getElementById('form-beh-participation').value)||4,
                communication:parseInt(document.getElementById('form-beh-communication').value)||4,
                teamwork:parseInt(document.getElementById('form-beh-teamwork').value)||4,
                confidence:parseInt(document.getElementById('form-beh-confidence').value)||4
            },
            teacher_term_remarks:getRemarks(),
            co_curricular_activities:getActivities(),
            awards:getAwards(),
            examination_progress:activeModalStudent?.examination_progress||[],
            subject_performance:activeModalStudent?.subject_performance||[],
            parent_meetings:activeModalStudent?.parent_meetings||[]
        };
        const isEdit=!!activeModalStudent;
        const url=isEdit?`/api/admin/student/update/${activeModalStudent.id}`:'/api/admin/student/create';
        const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const d=await res.json();
        if(d.success){hideModal('student-modal');showToast(isEdit?'Student updated!':'Student added!','success');loadStudentTable();}
        else showToast(d.message||'Error.','error');
    });

    // ============================================================
    // VIEW STUDENT (Report Card)
    // ============================================================
    window.viewStudent = async function(id) {
        const res=await fetch(`/api/student/${id}`);
        const s=await res.json();
        if(s.error){showToast('Student not found.','error');return;}
        activeStudentObject=s; currentStudentId=id;
        renderStudentDashboard(s, false);
    };

    async function loadParentDashboard(sid) {
        if(!sid) return;
        const res=await fetch(`/api/student/${sid}`);
        const s=await res.json();
        if(s.error){showToast('Student not found.','error');return;}
        activeStudentObject=s; currentStudentId=sid;
        document.getElementById('parent-settings-btn')?.classList.remove('hidden');
        renderStudentDashboard(s, true);
    }

    function renderStudentDashboard(student, isParent) {
        if(liveTickerInterval) clearInterval(liveTickerInterval);
        adminView.classList.add('hidden');
        reportView.classList.remove('hidden');

        // Profile
        setEl('profile-name', student.name);
        const initials = student.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
        setEl('profile-initials', initials);
        setEl('profile-admission-no', student.admission_no||'—');
        setEl('profile-roll-no', student.roll_no);
        setEl('profile-class-section', `Class ${student.class} - Section ${student.section}`);
        setEl('profile-academic-year', student.academic_year||'—');
        setEl('profile-dob', formatDate(student.dob));
        setEl('profile-parent-name', student.parent_name||'—');
        setEl('profile-parent-contact', student.parent_contact||'—');
        setEl('profile-parent-alt', student.parent_alt_contact||'—');

        const trendBadge = document.getElementById('profile-trend-badge');
        if(trendBadge) {
            trendBadge.textContent = student.performance_trend||'Stable';
            trendBadge.className=`status-badge ${student.performance_trend==='Improving'?'badge-success':student.performance_trend==='Declining'?'badge-danger':'badge-info'}`;
        }

        // Attendance ring
        const att = student.current_status?.attendance_percentage||0;
        setEl('attendance-percent',`${att}%`);
        const ring = document.getElementById('attendance-ring');
        if(ring){
            const offset=251.2-(att/100)*251.2;
            ring.style.strokeDashoffset=offset;
            ring.style.stroke=att>=75?'#10b981':att>=50?'#f59e0b':'#ef4444';
        }
        setEl('attendance-status-txt',att>=90?'Excellent standing':att>=75?'Good standing':att>=50?'Needs attention':'Critical');
        setEl('live-student-attendance-status',student.attendance_status||'Present');

        // Live ticker
        updateLiveClassroom(student.timetable||{});
        liveTickerInterval=setInterval(()=>updateLiveClassroom(student.timetable||{}),30000);

        renderOverview(student);
        renderAcademics(student);
        renderBehavior(student);
        renderActivitiesList(student);
        renderMeetingsList(student);
        renderFeedback(student, isParent);

        // Tab reset
        document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
        document.querySelectorAll('.tab-content').forEach((c,i)=>c.classList.toggle('active',i===0).classList?.toggle('hidden',i!==0));
        document.querySelectorAll('.tab-content').forEach((c,i)=>{ c.classList.toggle('active',i===0); if(i!==0) c.classList.add('hidden'); else c.classList.remove('hidden'); });

        lucide.createIcons();
    }

    // LIVE CLASSROOM
    function parseTime(str) {
        if(!str) return null;
        const m=str.trim().toUpperCase().match(/^(\d+):(\d+)\s*(AM|PM)$/);
        if(!m) return null;
        let h=parseInt(m[1]); const min=parseInt(m[2]); const ap=m[3];
        if(ap==='PM'&&h!==12) h+=12; if(ap==='AM'&&h===12) h=0;
        return h*60+min;
    }

    function updateLiveClassroom(timetable) {
        const now=new Date();
        const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const day=dayNames[now.getDay()];
        setEl('live-clock',now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
        const isWeekend=now.getDay()===0||now.getDay()===6;
        if(isWeekend){
            setEl('live-status','🏖️ Weekend');
            setEl('live-period','—'); setEl('live-subject','Weekend — No Classes');
            setEl('live-teacher','—'); setEl('live-room','—');
            return;
        }
        const schedule=timetable[day]||[];
        const nowMins=now.getHours()*60+now.getMinutes();
        let current=null;
        for(const p of schedule){
            const[s,e]=(p.time||'').split(' - ');
            const sM=parseTime(s), eM=parseTime(e);
            if(sM!==null&&eM!==null&&nowMins>=sM&&nowMins<eM){current=p;break;}
        }
        if(current){
            setEl('live-status',current.status||'Class In Progress');
            setEl('live-period',current.period||'—'); setEl('live-subject',current.subject||'—');
            setEl('live-teacher',current.teacher||'—'); setEl('live-room',current.room||'—');
        } else {
            setEl('live-status','No Active Period');
            setEl('live-period','—'); setEl('live-subject','School hours not started or over');
            setEl('live-teacher','—'); setEl('live-room','—');
        }
    }

    // RENDER OVERVIEW
    function renderOverview(student) {
        const prog=student.examination_progress||[];
        const latest=prog[prog.length-1];
        const marksCon=document.getElementById('current-term-marks-list');
        if(marksCon){
            if(!latest?.subjects||!latest.subjects.length){marksCon.innerHTML='<p style="color:var(--text-muted);">No marks recorded.</p>';return;}
            marksCon.innerHTML=latest.subjects.map(sub=>{
                const pct=Math.round((sub.obtained/sub.max)*100);
                const col=pct>=75?'#10b981':pct>=50?'#f59e0b':'#ef4444';
                return `<div class="marks-bar-row">
                    <span class="marks-subject-name">${sub.name}</span>
                    <div class="marks-bar-bg"><div class="marks-bar-fill" style="width:${pct}%;background:${col};"></div></div>
                    <span class="marks-score" style="color:${col};">${sub.obtained}/${sub.max}</span>
                </div>`;
            }).join('');
        }

        // Radar chart
        const perf=student.subject_performance||[];
        const ctx=document.getElementById('overview-radar-chart');
        if(ctx&&perf.length>0){
            if(overviewRadarChartInstance) overviewRadarChartInstance.destroy();
            overviewRadarChartInstance=new Chart(ctx,{type:'radar',data:{
                labels:perf.map(p=>p.subject),
                datasets:[{label:'Score',data:perf.map(p=>p.score),fill:true,
                    backgroundColor:'rgba(99,102,241,0.15)',borderColor:'rgba(99,102,241,1)',
                    pointBackgroundColor:'rgba(99,102,241,1)'}]
            },options:{scales:{r:{min:0,max:100}},plugins:{legend:{display:false}}}});
        }

        // Remarks
        const remarks=student.teacher_term_remarks||[];
        const remEl=document.getElementById('term-remarks-list');
        if(remEl){
            remEl.innerHTML=remarks.length?remarks.map(r=>`
                <div class="remark-item">
                    <div class="remark-header">
                        <span class="remark-teacher">${r.teacher_name||'Teacher'}</span>
                        <span class="remark-subject">${r.subject||''}</span>
                        <span class="remark-date">${r.date||''}</span>
                    </div>
                    <p class="remark-text">${r.remark||''}</p>
                </div>`).join(''):`<p style="color:var(--text-muted);">No remarks recorded.</p>`;
        }
    }

    // RENDER ACADEMICS
    function renderAcademics(student) {
        const prog=student.examination_progress||[];
        const ctx=document.getElementById('academic-history-chart');
        if(ctx&&prog.length>0){
            if(academicChartInstance) academicChartInstance.destroy();
            const labels=prog.map(p=>p.exam_name||p.exam||'Exam');
            const data=prog.map(p=>{
                if(typeof p.percentage==='number') return p.percentage;
                if(p.subjects){
                    const tot=p.subjects.reduce((s,x)=>s+x.obtained,0);
                    const mx=p.subjects.reduce((s,x)=>s+x.max,0);
                    return mx>0?parseFloat(((tot/mx)*100).toFixed(1)):0;
                }
                return 0;
            });
            academicChartInstance=new Chart(ctx,{type:'line',data:{labels,datasets:[{
                label:'Percentage',data,borderColor:'rgb(99,102,241)',backgroundColor:'rgba(99,102,241,0.1)',
                tension:0.4,fill:true,pointRadius:5,pointHoverRadius:7}]},
                options:{responsive:true,scales:{y:{min:0,max:100}},plugins:{legend:{display:false}}}});
        }
        const ec=document.getElementById('exam-history-table-container');
        if(ec){
            ec.innerHTML=prog.length?prog.map(exam=>`
                <div style="margin-bottom:1.5rem;">
                    <h4 style="font-weight:600;margin-bottom:0.5rem;">${exam.exam_name||exam.exam||'Exam'} ${exam.year||''}</h4>
                    <div class="table-container"><table class="data-table"><thead><tr>
                        <th>Subject</th><th>Obtained</th><th>Max</th><th>Grade</th>
                    </tr></thead><tbody>
                        ${(exam.subjects||[]).map(sub=>{
                            const pct=Math.round((sub.obtained/sub.max)*100);
                            const g=pct>=90?'A+':pct>=80?'A':pct>=70?'B+':pct>=60?'B':pct>=50?'C':'F';
                            return `<tr><td>${sub.name}</td><td><strong>${sub.obtained}</strong></td><td>${sub.max}</td>
                                <td><span class="badge ${pct>=60?'badge-success':'badge-danger'}">${g}</span></td></tr>`;
                        }).join('')}
                    </tbody></table></div></div>`).join(''):`<div style="padding:1.5rem;color:var(--text-muted);">No exam records.</div>`;
        }
    }

    // RENDER BEHAVIOR (shows to both parents & admins)
    function renderBehavior(student) {
        const beh=student.behavioral_observation||{};
        const list=document.getElementById('behavior-ratings-list');
        if(list){
            const keys=Object.keys(beh);
            list.innerHTML=keys.length?keys.map(k=>{
                const pct=(beh[k]/5)*100;
                return `<div class="beh-rating-row">
                    <span class="beh-label">${k.charAt(0).toUpperCase()+k.slice(1)}</span>
                    <div class="beh-bar-bg"><div class="beh-bar-fill" style="width:${pct}%;"></div></div>
                    <span class="beh-score">${beh[k]}/5</span>
                </div>`;
            }).join(''):`<p style="color:var(--text-muted);">No behavioral data recorded by teacher.</p>`;
        }
        const ctx=document.getElementById('behavior-radar-chart');
        if(ctx){
            const labels=Object.keys(beh).map(k=>k.charAt(0).toUpperCase()+k.slice(1));
            const data=Object.values(beh);
            if(radarChartInstance) radarChartInstance.destroy();
            if(labels.length>0){
                radarChartInstance=new Chart(ctx,{type:'radar',data:{labels,datasets:[{
                    label:'Rating',data,fill:true,backgroundColor:'rgba(16,185,129,0.15)',
                    borderColor:'rgba(16,185,129,1)',pointBackgroundColor:'rgba(16,185,129,1)'}]},
                    options:{scales:{r:{min:0,max:5,ticks:{stepSize:1}}},plugins:{legend:{display:false}}}});
            }
        }
    }

    // RENDER ACTIVITIES LIST (parent portal view)
    function renderActivitiesList(student) {
        const acts=student.co_curricular_activities||[];
        const awards=student.awards||[];
        const aEl=document.getElementById('activities-list');
        if(aEl) aEl.innerHTML=acts.length?acts.map(a=>`
            <div class="activity-item">
                <span class="activity-icon">🎯</span>
                <div><strong>${a.name||a}</strong>
                    ${a.date?`<span class="activity-date">${a.date}</span>`:''}
                    ${a.description?`<p class="activity-desc">${a.description}</p>`:''}
                </div>
            </div>`).join(''):`<p style="color:var(--text-muted);">No activities recorded.</p>`;
        const awEl=document.getElementById('awards-list');
        if(awEl) awEl.innerHTML=awards.length?awards.map(a=>`
            <div class="award-item">
                <span class="award-icon">🏆</span>
                <div><strong>${a.title||a}</strong>
                    ${a.date?`<span class="activity-date">${a.date}</span>`:''}
                    ${a.description?`<p class="activity-desc">${a.description}</p>`:''}
                </div>
            </div>`).join(''):`<p style="color:var(--text-muted);">No awards recorded.</p>`;
    }

    // RENDER MEETINGS LIST
    async function renderMeetingsList(student) {
        const past=student.parent_meetings||[];
        const el=document.getElementById('meetings-list');
        if(el) el.innerHTML=past.length?past.map(m=>`
            <div class="meeting-item">
                <div class="meeting-header">
                    <strong>${m.purpose||m.title||'Meeting'}</strong>
                    <span class="meeting-date">${m.date||''}</span>
                </div>
                ${m.notes?`<p class="activity-desc">${m.notes}</p>`:''}
                ${m.outcome?`<p class="meeting-outcome">Outcome: ${m.outcome}</p>`:''}
            </div>`).join(''):`<p style="color:var(--text-muted);">No past meeting records.</p>`;

        // Scheduled meetings from principal
        const scheduledEl=document.getElementById('student-meetings-list');
        if(scheduledEl){
            try {
                const res=await fetch('/api/meetings');
                const meetings=await res.json();
                const cls=`${student.class}-${student.section}`;
                const relevant=meetings.filter(m=>m.classes==='all'||
                    (Array.isArray(m.classes)&&m.classes.includes(cls)));
                scheduledEl.innerHTML=relevant.length?relevant.map(m=>`
                    <div class="meeting-item" style="border-left-color:var(--primary);">
                        <div class="meeting-header">
                            <strong>📅 ${m.title||'Meeting'}</strong>
                            <span class="meeting-date">${m.date||''} at ${m.time||''}</span>
                        </div>
                        ${m.venue?`<p class="activity-desc">📍 Venue: ${m.venue}</p>`:''}
                        ${m.notes?`<p class="activity-desc">${m.notes}</p>`:''}
                    </div>`).join(''):`<p style="color:var(--text-muted);">No upcoming parent meetings scheduled.</p>`;
            } catch {}
        }
    }

    // RENDER FEEDBACK (sync to both teacher+principal)
    function renderFeedback(student, isParent) {
        const fbEl=document.getElementById('parent-feedback-text');
        const replyEl=document.getElementById('principal-reply-text');
        const adminReply=document.getElementById('admin-reply-actions');
        const replySection=document.getElementById('principal-reply-section');
        const submitBtn=document.getElementById('submit-feedback-btn');

        if(fbEl){
            fbEl.value=student.parent_feedback||'';
            fbEl.readOnly=!isParent;
        }
        if(replyEl) replyEl.value=student.principal_reply||'';
        if(adminReply) adminReply.classList.toggle('hidden', isParent);
        if(replySection) replySection.classList.remove('hidden');
        if(submitBtn) submitBtn.classList.toggle('hidden',!isParent);
        // Admin reply input
        const adminReplyInput=document.getElementById('admin-reply-input');
        if(adminReplyInput) adminReplyInput.value=student.principal_reply||'';
    }

    document.getElementById('submit-feedback-btn')?.addEventListener('click', async function() {
        const text=document.getElementById('parent-feedback-text')?.value.trim();
        const sid=localStorage.getItem('sptas_student_id');
        if(!text||!sid){showToast('Please write feedback.','error');return;}
        const res=await fetch('/api/parent/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({student_id:sid,feedback:text})});
        const d=await res.json();
        if(d.success) showToast('Feedback submitted!','success');
    });

    document.getElementById('save-principal-reply-btn')?.addEventListener('click', async function() {
        const text=document.getElementById('admin-reply-input')?.value.trim()||'';
        const sid=currentStudentId;
        if(!sid) return;
        const res=await fetch('/api/principal/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({student_id:sid,reply:text})});
        const d=await res.json();
        if(d.success){showToast('Reply saved!','success');setEl('principal-reply-text',text);}
    });

    // TAB NAVIGATION (report card)
    document.querySelectorAll('.tab-btn').forEach(btn=>{
        btn.addEventListener('click',function(){
            document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c=>{c.classList.remove('active');c.classList.add('hidden');});
            btn.classList.add('active');
            const tc=document.getElementById(btn.dataset.tab);
            if(tc){tc.classList.add('active');tc.classList.remove('hidden');}
        });
    });

    // Back button
    document.getElementById('back-to-search-btn')?.addEventListener('click',function(){
        if(liveTickerInterval) clearInterval(liveTickerInterval);
        if(currentRole==='parent') return;
        reportView.classList.add('hidden');
        adminView.classList.remove('hidden');
        loadStudentTable();
    });
    document.getElementById('print-pdf-btn')?.addEventListener('click',()=>window.print());
    document.getElementById('parent-settings-btn')?.addEventListener('click',()=>{
        const sid=localStorage.getItem('sptas_student_id');
        pendingPasswordRole={role:'parent',entityId:sid,name:localStorage.getItem('sptas_user_name')||'Parent'};
        showPasswordSetup('parent');
    });

    // ============================================================
    // TEACHERS TABLE
    // ============================================================
    async function loadTeachersTable() {
        const res=await fetch('/api/teachers');
        teachersCache=await res.json();
        const tbody=document.getElementById('teachers-table-body');
        tbody.innerHTML='';
        if(!teachersCache.length){
            tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">No teachers found.</td></tr>`;
            return;
        }
        teachersCache.forEach(t=>{
            const attBadge=t.attendance_status==='Present'
                ?`<span class="badge badge-success" style="cursor:pointer;" onclick="toggleTeacherAtt('${t.id}','Absent')">🟢 Present</span>`
                :`<span class="badge badge-danger" style="cursor:pointer;" onclick="toggleTeacherAtt('${t.id}','Present')">🔴 Absent</span>`;
            const pwdBadge=t.has_password?`<span class="badge badge-success">Set</span>`:`<span class="badge badge-warning">Not Set</span>`;
            const classesText=(t.classes||[]).join(', ')||'—';
            const tr=document.createElement('tr');
            tr.innerHTML=`<td><strong>${t.name}</strong></td>
                <td>${t.phone}</td>
                <td>${(t.subjects||[]).join(', ')||'—'}</td>
                <td>${classesText}</td>
                <td>${attBadge}</td>
                <td>${pwdBadge}</td>
                <td><div class="action-btns">
                    <button class="btn-action btn-edit" onclick="openEditTeacher('${t.id}')" title="Edit"><i data-lucide="pencil"></i></button>
                    <button class="btn-action btn-delete" onclick="requestDeleteTeacher('${t.id}','${t.name.replace(/'/g,'')}')" title="Delete"><i data-lucide="trash-2"></i></button>
                </div></td>`;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    }

    window.toggleTeacherAtt=async function(id,status){
        const res=await fetch('/api/teacher/attendance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teacher_id:id,status})});
        const d=await res.json(); if(d.success) loadTeachersTable();
    };

    // TEACHER MODAL
    document.getElementById('add-teacher-btn')?.addEventListener('click',openAddTeacher);
    function openAddTeacher(){
        document.getElementById('teacher-modal-title').textContent='Add New Teacher';
        document.getElementById('teacher-form-id').value='';
        document.getElementById('tf-name').value='';
        document.getElementById('tf-phone').value='';
        document.getElementById('tf-email').value='';
        document.getElementById('tf-subjects').value='';
        document.getElementById('tf-classes-tag-list').innerHTML='';
        document.getElementById('teacher-form-error').classList.add('hidden');
        showModal('teacher-modal-overlay');
    }
    window.openEditTeacher=async function(id){
        const res=await fetch('/api/teachers');
        const ts=await res.json();
        const t=ts.find(x=>x.id===id);
        if(!t) return;
        document.getElementById('teacher-modal-title').textContent='Edit Teacher';
        document.getElementById('teacher-form-id').value=t.id;
        document.getElementById('tf-name').value=t.name;
        document.getElementById('tf-phone').value=t.phone;
        document.getElementById('tf-email').value=t.email||'';
        document.getElementById('tf-subjects').value=(t.subjects||[]).join(', ');
        // Classes tags
        const tagList=document.getElementById('tf-classes-tag-list');
        tagList.innerHTML=(t.classes||[]).map(c=>`
            <span class="class-tag">${c}
                <button type="button" class="tag-remove" onclick="this.parentElement.remove()">×</button>
            </span>`).join('');
        document.getElementById('teacher-form-error').classList.add('hidden');
        showModal('teacher-modal-overlay');
    };
    document.getElementById('teacher-modal-close')?.addEventListener('click',()=>hideModal('teacher-modal-overlay'));
    document.getElementById('teacher-modal-cancel')?.addEventListener('click',()=>hideModal('teacher-modal-overlay'));

    // Add class tag
    document.getElementById('tf-add-class-btn')?.addEventListener('click',function(){
        const cls=document.getElementById('tf-class-pick').value;
        const sec=document.getElementById('tf-section-pick').value;
        if(!cls){showToast('Select a class.','error');return;}
        const label=`${cls}-${sec}`;
        const tagList=document.getElementById('tf-classes-tag-list');
        if(tagList.querySelector(`[data-class="${label}"]`)){showToast('Already added.','error');return;}
        const span=document.createElement('span');
        span.className='class-tag'; span.setAttribute('data-class',label);
        span.innerHTML=`${label} <button type="button" class="tag-remove" onclick="this.parentElement.remove()">×</button>`;
        tagList.appendChild(span);
    });

    document.getElementById('teacher-form')?.addEventListener('submit',async function(e){
        e.preventDefault();
        const errEl=document.getElementById('teacher-form-error');
        const id=document.getElementById('teacher-form-id').value;
        const phone=document.getElementById('tf-phone').value.trim();
        if(!validatePhone(phone)){errEl.textContent='Phone must be 10 digits or less.';errEl.classList.remove('hidden');return;}
        const classes=[...document.querySelectorAll('#tf-classes-tag-list .class-tag')].map(el=>el.getAttribute('data-class')).filter(Boolean);
        const body={
            name:document.getElementById('tf-name').value.trim(),
            phone:cleanPhone(phone),
            email:document.getElementById('tf-email').value.trim(),
            subjects:document.getElementById('tf-subjects').value.split(',').map(s=>s.trim()).filter(s=>s),
            classes
        };
        const url=id?`/api/teacher/update/${id}`:'/api/teacher/create';
        const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const d=await res.json();
        if(d.success){hideModal('teacher-modal-overlay');showToast(id?'Teacher updated.':'Teacher added.','success');loadTeachersTable();}
        else{errEl.textContent=d.message||'Error.';errEl.classList.remove('hidden');}
    });

    // ============================================================
    // ATTENDANCE PORTAL
    // ============================================================
    document.getElementById('att-load-btn')?.addEventListener('click',loadAttendanceList);
    async function loadAttendanceList(){
        const cls=document.getElementById('att-class-filter').value;
        const sec=document.getElementById('att-section-filter').value;
        const date=document.getElementById('att-date-filter').value;
        if(!cls){showToast('Select a class.','error');return;}
        if(!date){showToast('Select a date.','error');return;}
        const res=await fetch(`/api/attendance/class?class=${cls}&section=${sec}&date=${date}`);
        const students=await res.json();
        const container=document.getElementById('attendance-list-container');
        const saveBtn=document.getElementById('att-save-btn');
        if(!students.length){
            container.innerHTML=`<p style="color:var(--text-muted);text-align:center;padding:2rem;">No students in Class ${cls}${sec?'-'+sec:''}.</p>`;
            saveBtn.style.display='none'; return;
        }
        saveBtn.style.display='';
        let html=`<div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="markAllAtt('Present')">✅ All Present</button>
            <button class="btn btn-secondary btn-sm" onclick="markAllAtt('Absent')">❌ All Absent</button>
        </div><div class="table-container"><table class="data-table">
        <thead><tr><th>#</th><th>Roll No</th><th>Name</th><th>Present</th><th>Half Day</th><th>Absent</th></tr></thead><tbody>`;
        students.forEach((s,i)=>{
            const isP=s.attendance_status==='Present', isH=s.attendance_status==='Half Day', isA=s.attendance_status==='Absent';
            html+=`<tr id="att-row-${s.id}" data-student-id="${s.id}" class="${isA?'row-absent':isH?'row-halfday':''}">
                <td>${i+1}</td><td><strong>${s.roll_no}</strong></td><td>${s.name}</td>
                <td style="text-align:center;"><input type="radio" name="att_${s.id}" value="Present" ${isP?'checked':''} onchange="updateAttRow('${s.id}','Present')"></td>
                <td style="text-align:center;"><input type="radio" name="att_${s.id}" value="Half Day" ${isH?'checked':''} onchange="updateAttRow('${s.id}','Half Day')"></td>
                <td style="text-align:center;"><input type="radio" name="att_${s.id}" value="Absent" ${isA?'checked':''} onchange="updateAttRow('${s.id}','Absent')"></td>
            </tr>`;
        });
        html+=`</tbody></table></div>`;
        container.innerHTML=html;
    }
    window.updateAttRow=function(id,status){
        const r=document.getElementById(`att-row-${id}`);
        if(!r) return;
        r.className=status==='Absent'?'row-absent':status==='Half Day'?'row-halfday':'';
    };
    window.markAllAtt=function(status){
        document.querySelectorAll('[data-student-id]').forEach(row=>{
            const sid=row.getAttribute('data-student-id');
            const radio=row.querySelector(`input[value="${status}"]`);
            if(radio){radio.checked=true;updateAttRow(sid,status);}
        });
    };
    document.getElementById('att-save-btn')?.addEventListener('click',async function(){
        const date=document.getElementById('att-date-filter').value;
        const records=[];
        document.querySelectorAll('[data-student-id]').forEach(row=>{
            const sid=row.getAttribute('data-student-id');
            const checked=row.querySelector('input[type=radio]:checked');
            if(checked) records.push({student_id:sid,status:checked.value});
        });
        if(!records.length){showToast('No attendance data.','error');return;}
        const res=await fetch('/api/attendance/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,records})});
        const d=await res.json();
        if(d.success) showToast(`Saved for ${d.updated} students.`,'success');
        else showToast('Failed.','error');
    });

    // ============================================================
    // TIMETABLE MANAGER
    // ============================================================
    document.getElementById('tt-load-btn')?.addEventListener('click',loadTimetableEditor);
    async function loadTimetableEditor(){
        const cls=document.getElementById('tt-class-select').value;
        const sec=document.getElementById('tt-section-select').value;
        if(!cls){showToast('Select a class.','error');return;}
        currentTimetableKey=`${cls}-${sec}`;
        const res=await fetch(`/api/timetable/${currentTimetableKey}`);
        const data=await res.json();
        const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const emptyDay=()=>[
            {period:'1',time:'08:30 AM - 09:30 AM',subject:'',teacher:'',room:'',status:'Class In Progress'},
            {period:'Recess',time:'09:30 AM - 09:45 AM',subject:'Break Time',teacher:'-',room:'Playground',status:'Recess'},
            {period:'2',time:'09:45 AM - 10:45 AM',subject:'',teacher:'',room:'',status:'Class In Progress'},
            {period:'Lunch',time:'12:45 PM - 01:15 PM',subject:'Lunch Break',teacher:'-',room:'Cafeteria',status:'Break'},
            {period:'3',time:'01:15 PM - 02:15 PM',subject:'',teacher:'',room:'',status:'Class In Progress'}
        ];
        currentTimetableData=data.timetable||{};
        days.forEach(d=>{if(!currentTimetableData[d]) currentTimetableData[d]=emptyDay();});
        renderTimetableEditor();
        document.getElementById('tt-save-btn').style.display='';
        document.getElementById('tt-save-btn').innerHTML=`<i data-lucide="save"></i> Save & Apply to ${currentTimetableKey}`;
        lucide.createIcons();
    }

    function renderTimetableEditor(){
        const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const container=document.getElementById('timetable-editor-container');
        let html=`<div class="timetable-days-tabs">`;
        days.forEach((d,i)=>`${html+=`<button class="tt-day-btn${i===0?' active':''}" onclick="switchTTDay('${d}',this)">${d.slice(0,3)}</button>`}`);
        html+=`</div>
        <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="applyToAllDays()">
                <i data-lucide="copy"></i> Apply Monday to All Days
            </button>
        </div>
        <div id="tt-day-editor" style="margin-top:1rem;"></div>`;
        container.innerHTML=html;
        renderTTDayEditor('Monday');
        lucide.createIcons();
    }

    window.switchTTDay=function(day,btn){
        document.querySelectorAll('.tt-day-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        saveTTDayToMemory();
        renderTTDayEditor(day);
    };
    window.applyToAllDays=function(){
        saveTTDayToMemory();
        const mondayData=currentTimetableData['Monday']||[];
        ['Tuesday','Wednesday','Thursday','Friday','Saturday'].forEach(d=>{
            currentTimetableData[d]=JSON.parse(JSON.stringify(mondayData));
        });
        showToast('Monday timetable applied to all days!','success');
    };

    function saveTTDayToMemory(){
        const rows=document.querySelectorAll('#tt-periods-table tbody tr');
        const periods=[];
        rows.forEach(row=>periods.push({
            period:row.querySelector('.tt-period-no')?.value||'',
            time:row.querySelector('.tt-period-time')?.value||'',
            subject:row.querySelector('.tt-period-subject')?.value||'',
            teacher:row.querySelector('.tt-period-teacher')?.value||'',
            room:row.querySelector('.tt-period-room')?.value||'',
            status:row.querySelector('.tt-period-status')?.value||'Class In Progress'
        }));
        currentTimetableData[currentEditingDay]=periods;
    }

    function renderTTDayEditor(day){
        currentEditingDay=day;
        const periods=currentTimetableData[day]||[];
        const teacherOptions=teachersCache.map(t=>`<option value="${t.name}">${t.name}</option>`).join('');
        const editor=document.getElementById('tt-day-editor');
        let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
            <h4 style="font-weight:600;">${day} Schedule</h4>
            <button class="btn btn-secondary btn-sm" onclick="addPeriodRow()"><i data-lucide="plus"></i> Add Period</button>
        </div>
        <div class="table-container"><table class="data-table" id="tt-periods-table">
        <thead><tr><th>Period</th><th>Time (Start - End)</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Type</th><th>Del</th></tr></thead>
        <tbody>`;
        periods.forEach(p=>{
            html+=`<tr>
                <td><input type="text" class="form-input tt-period-no" value="${p.period}" style="width:55px;"></td>
                <td><input type="text" class="form-input tt-period-time" value="${p.time}" style="width:185px;"></td>
                <td><input type="text" class="form-input tt-period-subject" value="${p.subject}"></td>
                <td>
                    <select class="form-select tt-period-teacher" style="min-width:130px;">
                        <option value="${p.teacher}">${p.teacher||'Select Teacher'}</option>
                        ${teacherOptions}
                    </select>
                </td>
                <td><input type="text" class="form-input tt-period-room" value="${p.room}" style="width:80px;"></td>
                <td>
                    <select class="form-select tt-period-status" style="width:145px;">
                        <option ${p.status==='Class In Progress'?'selected':''}>Class In Progress</option>
                        <option ${p.status==='Recess'?'selected':''}>Recess</option>
                        <option ${p.status==='Break'?'selected':''}>Break</option>
                        <option ${p.status==='Free Period'?'selected':''}>Free Period</option>
                    </select>
                </td>
                <td><button class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>
            </tr>`;
        });
        html+=`</tbody></table></div>`;
        editor.innerHTML=html;
        lucide.createIcons();
    }

    window.addPeriodRow=function(){
        const tbody=document.querySelector('#tt-periods-table tbody'); if(!tbody) return;
        const teacherOptions=teachersCache.map(t=>`<option>${t.name}</option>`).join('');
        const row=document.createElement('tr');
        row.innerHTML=`<td><input type="text" class="form-input tt-period-no" value="P" style="width:55px;"></td>
            <td><input type="text" class="form-input tt-period-time" value="00:00 AM - 00:00 AM" style="width:185px;"></td>
            <td><input type="text" class="form-input tt-period-subject" value=""></td>
            <td><select class="form-select tt-period-teacher" style="min-width:130px;"><option value="">Select Teacher</option>${teacherOptions}</select></td>
            <td><input type="text" class="form-input tt-period-room" value="" style="width:80px;"></td>
            <td><select class="form-select tt-period-status" style="width:145px;">
                <option>Class In Progress</option><option>Recess</option><option>Break</option><option>Free Period</option>
            </select></td>
            <td><button class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>`;
        tbody.appendChild(row); lucide.createIcons();
    };

    document.getElementById('tt-save-btn')?.addEventListener('click',async function(){
        saveTTDayToMemory();
        const res=await fetch('/api/timetable/save',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({class_key:currentTimetableKey,timetable:currentTimetableData})});
        const d=await res.json();
        if(d.success) showToast(`Timetable saved for ${currentTimetableKey}!`,'success');
        else showToast('Failed.','error');
    });

    // ============================================================
    // PARENT MEETINGS ADMIN
    // ============================================================
    document.getElementById('add-meeting-btn')?.addEventListener('click',()=>{
        document.getElementById('meeting-form-id').value='';
        document.getElementById('meeting-modal-title').textContent='Schedule Parent Meeting';
        document.getElementById('mtg-title').value='';
        document.getElementById('mtg-date').value='';
        document.getElementById('mtg-time').value='';
        document.getElementById('mtg-venue').value='';
        document.getElementById('mtg-notes').value='';
        document.getElementById('mtg-classes').value='all';
        document.getElementById('mtg-class-picker').classList.add('hidden');
        showModal('meeting-modal-overlay');
    });
    document.getElementById('meeting-modal-close')?.addEventListener('click',()=>hideModal('meeting-modal-overlay'));
    document.getElementById('meeting-modal-cancel')?.addEventListener('click',()=>hideModal('meeting-modal-overlay'));

    document.getElementById('mtg-classes')?.addEventListener('change',function(){
        document.getElementById('mtg-class-picker')?.classList.toggle('hidden',this.value!=='custom');
    });

    document.getElementById('meeting-save-btn')?.addEventListener('click',async function(){
        const title=document.getElementById('mtg-title').value.trim();
        const date=document.getElementById('mtg-date').value;
        const time=document.getElementById('mtg-time').value;
        if(!title||!date){showToast('Title and Date are required.','error');return;}
        const classesMode=document.getElementById('mtg-classes').value;
        let classes='all';
        if(classesMode==='custom'){
            classes=[...document.querySelectorAll('input[name="mtg-class"]:checked')].map(cb=>cb.value);
        }
        const body={
            id:document.getElementById('meeting-form-id').value||undefined,
            title,date,time,venue:document.getElementById('mtg-venue').value.trim(),
            classes,notes:document.getElementById('mtg-notes').value.trim()
        };
        const res=await fetch('/api/meetings/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const d=await res.json();
        if(d.success){hideModal('meeting-modal-overlay');showToast('Meeting saved!','success');loadMeetingsAdmin();}
        else showToast('Error.','error');
    });

    async function loadMeetingsAdmin(){
        const res=await fetch('/api/meetings');
        const meetings=await res.json();
        const container=document.getElementById('meetings-admin-container');
        if(!container) return;
        if(!meetings.length){
            container.innerHTML=`<p style="color:var(--text-muted);text-align:center;padding:2rem;">No meetings scheduled yet.</p>`;
            return;
        }
        container.innerHTML=meetings.map(m=>`
            <div class="meeting-item" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                <div>
                    <strong>${m.title}</strong>
                    <span class="meeting-date">${m.date} at ${m.time||''}</span>
                    ${m.venue?`<span class="activity-desc">📍 ${m.venue}</span>`:''}
                    <span class="badge badge-info" style="margin-top:0.3rem;">
                        ${m.classes==='all'?'All Classes':Array.isArray(m.classes)?m.classes.join(', '):m.classes}
                    </span>
                </div>
                <div class="action-btns">
                    <button class="btn-action btn-delete" onclick="deleteMeeting('${m.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
                </div>
            </div>`).join('');
        lucide.createIcons();
    }

    window.deleteMeeting=async function(id){
        const res=await fetch(`/api/meetings/delete/${id}`,{method:'POST'});
        const d=await res.json();
        if(d.success){showToast('Meeting deleted.','success');loadMeetingsAdmin();}
    };

    // ============================================================
    // MONTHLY REPORTS
    // ============================================================
    document.getElementById('report-load-btn')?.addEventListener('click',generateMonthlyReport);
    async function generateMonthlyReport(){
        const month=document.getElementById('report-month').value;
        const cls=document.getElementById('report-class').value;
        const sec=document.getElementById('report-section').value;
        if(!month){showToast('Select a month.','error');return;}
        let url=`/api/attendance/report?month=${month}`;
        if(cls) url+=`&class=${cls}`; if(sec) url+=`&section=${sec}`;
        const res=await fetch(url);
        const report=await res.json();
        const container=document.getElementById('monthly-report-container');
        if(!report.length){container.innerHTML=`<p style="text-align:center;color:var(--text-muted);padding:2rem;">No data found.</p>`;return;}
        const[year,mNum]=month.split('-');
        const mName=new Date(year,parseInt(mNum)-1,1).toLocaleString('default',{month:'long'});
        container.innerHTML=`
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                <h4 style="font-weight:600;">Report — ${mName} ${year}</h4>
                <span class="badge badge-info">${report.length} Students</span>
            </div>
            <div class="table-container"><table class="data-table">
            <thead><tr><th>#</th><th>Name</th><th>Class</th><th>Roll</th>
                <th>Present</th><th>Half Day</th><th>Absent</th><th>Total</th><th>%</th></tr></thead>
            <tbody>
            ${report.map((r,i)=>{
                const col=r.percentage>=75?'#16a34a':r.percentage>=50?'#d97706':'#dc2626';
                return `<tr><td>${i+1}</td><td><strong>${r.name}</strong></td>
                    <td>${r.class}-${r.section}</td><td>${r.roll_no}</td>
                    <td style="color:#16a34a;">${r.present_days}</td>
                    <td style="color:#d97706;">${r.half_days}</td>
                    <td style="color:#dc2626;">${r.absent_days}</td>
                    <td>${r.total_days}</td>
                    <td><strong style="color:${col};">${r.percentage}%</strong></td></tr>`;
            }).join('')}
            </tbody></table></div>`;
    }

    // Modal timetable day switch
    document.getElementById('modal-timetable-day-select')?.addEventListener('change',function(){
        renderModalTimetableDay(this.value);
    });
    function renderModalTimetableDay(day) {
        const tbody=document.getElementById('modal-timetable-rows');
        if(!tbody) return;
        const periods=activeModalStudent?.timetable?.[day]||[];
        tbody.innerHTML=periods.map(p=>`<tr>
            <td><input type="text" class="form-input mt-period" value="${p.period}" style="width:50px;"></td>
            <td><input type="text" class="form-input mt-time" value="${p.time}" style="width:175px;"></td>
            <td><input type="text" class="form-input mt-subject" value="${p.subject}"></td>
            <td><input type="text" class="form-input mt-teacher" value="${p.teacher}"></td>
            <td><input type="text" class="form-input mt-room" value="${p.room}" style="width:70px;"></td>
            <td><select class="form-select mt-status" style="width:135px;">
                <option ${p.status==='Class In Progress'?'selected':''}>Class In Progress</option>
                <option ${p.status==='Recess'?'selected':''}>Recess</option>
                <option ${p.status==='Break'?'selected':''}>Break</option>
                <option ${p.status==='Free Period'?'selected':''}>Free Period</option>
            </select></td>
            <td><button type="button" class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>
        </tr>`).join('');
        lucide.createIcons();
    }
    document.getElementById('modal-add-period-row')?.addEventListener('click',function(){
        const tbody=document.getElementById('modal-timetable-rows'); if(!tbody) return;
        const row=document.createElement('tr');
        row.innerHTML=`<td><input type="text" class="form-input mt-period" value="" style="width:50px;"></td>
            <td><input type="text" class="form-input mt-time" value="" style="width:175px;"></td>
            <td><input type="text" class="form-input mt-subject" value=""></td>
            <td><input type="text" class="form-input mt-teacher" value=""></td>
            <td><input type="text" class="form-input mt-room" value="" style="width:70px;"></td>
            <td><select class="form-select mt-status" style="width:135px;">
                <option>Class In Progress</option><option>Recess</option><option>Break</option><option>Free Period</option>
            </select></td>
            <td><button type="button" class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>`;
        tbody.appendChild(row); lucide.createIcons();
    });

    // ============================================================
    // EXCEL IMPORT / EXPORT
    // ============================================================

    // ---- DOWNLOAD SAMPLE TEMPLATE ----
    document.getElementById('excel-dl-btn')?.addEventListener('click', function() {
        const cls     = document.getElementById('excel-dl-class')?.value || '10';
        const sec     = document.getElementById('excel-dl-section')?.value || 'A';
        const max     = document.getElementById('excel-dl-maxmarks')?.value || '100';
        const subjects= document.getElementById('excel-dl-subjects')?.value.trim() || 'Mathematics,Science,English,Hindi,Social Studies';
        if (!cls) { showToast('Please select a class.', 'error'); return; }
        const url = `/api/excel/sample-marks?class=${encodeURIComponent(cls)}&section=${sec}&max_marks=${max}&subjects=${encodeURIComponent(subjects)}`;
        showToast(`Generating Excel for Class ${cls}-${sec}... Downloading!`, 'success');
        const a = document.createElement('a');
        a.href = url; a.download = `SPTAS_Template_Class${cls}${sec}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });

    // ---- MARKS UPLOAD: Drag & Drop ----
    setupDropZone('marks-drop-zone', 'marks-file-input', uploadMarksFile);

    document.getElementById('marks-file-input')?.addEventListener('change', function() {
        if (this.files[0]) uploadMarksFile(this.files[0]);
    });

    async function uploadMarksFile(file) {
        const progressDiv = document.getElementById('marks-upload-progress');
        const progressFill = document.getElementById('marks-progress-fill');
        const progressText = document.getElementById('marks-progress-text');
        const resultDiv = document.getElementById('marks-upload-result');

        progressDiv.classList.remove('hidden');
        resultDiv.classList.add('hidden');
        // Animate progress bar
        let prog = 0;
        const interval = setInterval(() => {
            prog = Math.min(prog + 10, 85);
            progressFill.style.width = prog + '%';
        }, 200);

        const form = new FormData();
        form.append('file', file);
        progressText.textContent = `Processing "${file.name}"...`;

        try {
            const res = await fetch('/api/excel/upload-marks', { method: 'POST', body: form });
            const data = await res.json();
            clearInterval(interval);
            progressFill.style.width = '100%';
            setTimeout(() => {
                progressDiv.classList.add('hidden');
                progressFill.style.width = '0%';
            }, 600);

            resultDiv.classList.remove('hidden');
            if (data.success) {
                showToast(`✅ ${data.updated} student records updated!`, 'success');
                renderMarksUploadResult(data);
                loadStudentTable(); // refresh table
            } else {
                resultDiv.innerHTML = `<div class="upload-result-error"><i data-lucide="alert-circle"></i> ${data.message}</div>`;
                lucide.createIcons();
            }
        } catch(e) {
            clearInterval(interval);
            progressDiv.classList.add('hidden');
            resultDiv.classList.remove('hidden');
            resultDiv.innerHTML = `<div class="upload-result-error"><i data-lucide="wifi-off"></i> Connection error: ${e.message}</div>`;
            lucide.createIcons();
        }
    }

    function renderMarksUploadResult(data) {
        const div = document.getElementById('marks-upload-result');
        const errors = data.errors || [];
        const results = data.results || [];

        // Group by exam
        const examMap = {};
        results.forEach(r => {
            if (!examMap[r.exam]) examMap[r.exam] = [];
            examMap[r.exam].push(r);
        });

        let html = `
            <div class="upload-result-banner success">
                <i data-lucide="check-circle"></i>
                <div>
                    <strong>${data.updated} student records updated</strong>
                    <p>${Object.keys(examMap).length} exam(s) processed</p>
                </div>
            </div>`;

        Object.entries(examMap).forEach(([exam, rows]) => {
            html += `
            <div style="margin-top:1.25rem;">
                <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.5rem;display:flex;align-items:center;gap:0.5rem;">
                    📝 ${exam}
                    <span class="badge badge-info">${rows.length} Students</span>
                </div>
                <div class="table-container">
                <table class="data-table">
                <thead><tr>
                    <th>Rank</th><th>Roll No</th><th>Student Name</th>
                    <th>Total</th><th>Percentage</th><th>Grade</th>
                </tr></thead><tbody>
                ${rows.map(r => {
                    const gc = r.grade==='A+'?'D4EDDA':r.grade==='A'?'C3E6CB':r.grade==='B+'?'D1ECF1':r.grade==='B'?'BEE5EB':r.grade==='C'?'FFF3CD':r.grade==='D'?'FFE8A1':'F8D7DA';
                    return `<tr>
                        <td><strong style="color:var(--primary);">#${r.rank}</strong></td>
                        <td>${r.roll_no}</td>
                        <td>${r.name}</td>
                        <td><strong>${r.total}</strong></td>
                        <td><strong>${r.percentage}%</strong></td>
                        <td><span style="background:#${gc};padding:0.2rem 0.6rem;border-radius:12px;font-weight:700;font-size:0.78rem;">${r.grade}</span></td>
                    </tr>`;
                }).join('')}
                </tbody></table></div>
            </div>`;
        });

        if (errors.length) {
            html += `<div class="upload-result-errors" style="margin-top:1rem;">
                <strong>⚠️ Warnings (${errors.length}):</strong>
                <ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>
            </div>`;
        }
        div.innerHTML = html;
        lucide.createIcons();
    }

    // ---- ATTENDANCE UPLOAD: Drag & Drop ----
    setupDropZone('att-drop-zone', 'att-file-input', uploadAttFile);

    document.getElementById('att-file-input')?.addEventListener('change', function() {
        if (this.files[0]) uploadAttFile(this.files[0]);
    });

    async function uploadAttFile(file) {
        const resultDiv = document.getElementById('att-upload-result');
        resultDiv.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--text-muted);">⏳ Processing attendance...</div>`;
        resultDiv.classList.remove('hidden');
        const form = new FormData();
        form.append('file', file);
        try {
            const res = await fetch('/api/excel/upload-attendance', { method: 'POST', body: form });
            const data = await res.json();
            if (data.success) {
                showToast(`✅ Attendance updated for ${data.updated} students across ${data.date_columns} dates!`, 'success');
                resultDiv.innerHTML = `
                    <div class="upload-result-banner success">
                        <i data-lucide="check-circle"></i>
                        <div>
                            <strong>${data.updated} student attendance records updated</strong>
                            <p>${data.date_columns} date columns processed</p>
                        </div>
                    </div>`;
                loadStudentTable();
            } else {
                resultDiv.innerHTML = `<div class="upload-result-error"><i data-lucide="alert-circle"></i> ${data.message}</div>`;
            }
            lucide.createIcons();
        } catch(e) {
            resultDiv.innerHTML = `<div class="upload-result-error">Error: ${e.message}</div>`;
        }
    }

    // ---- DOWNLOAD RESULTS REPORT ----
    document.getElementById('excel-rep-btn')?.addEventListener('click', function() {
        const cls  = document.getElementById('excel-rep-class')?.value || '';
        const sec  = document.getElementById('excel-rep-section')?.value || '';
        const exam = document.getElementById('excel-rep-exam')?.value || '';
        const params = new URLSearchParams();
        if (cls) params.set('class', cls);
        if (sec) params.set('section', sec);
        if (exam) params.set('exam', exam);
        showToast('Generating results report...', 'success');
        const a = document.createElement('a');
        a.href = `/api/excel/results-report?${params.toString()}`;
        a.download = `SPTAS_Results.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });

    // ---- DOWNLOAD STUDENT REGISTRATION TEMPLATE ----
    document.getElementById('excel-reg-dl-btn')?.addEventListener('click', function() {
        const cls = document.getElementById('excel-reg-dl-class')?.value || '10';
        const sec = document.getElementById('excel-reg-dl-section')?.value || 'A';
        const subjects = document.getElementById('excel-reg-dl-subjects')?.value.trim() || 'Telugu,Hindi,Mathematics,Science,Social,English';
        if (!cls) { showToast('Please select a class.', 'error'); return; }
        const url = `/api/excel/sample-register?class=${encodeURIComponent(cls)}&section=${sec}&subjects=${encodeURIComponent(subjects)}`;
        showToast(`Generating registration template for Class ${cls}-${sec}... Downloading!`, 'success');
        const a = document.createElement('a');
        a.href = url; a.download = `SPTAS_Student_Register_Class${cls}.xlsx`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });

    // ---- STUDENT REGISTRATION UPLOAD ----
    setupDropZone('reg-drop-zone', 'reg-file-input', uploadRegFile);

    document.getElementById('reg-file-input')?.addEventListener('change', function() {
        if (this.files[0]) uploadRegFile(this.files[0]);
    });

    async function uploadRegFile(file) {
        const resultDiv = document.getElementById('reg-upload-result');
        if (!resultDiv) return;
        resultDiv.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--text-muted);">⏳ Processing bulk student registration...</div>`;
        resultDiv.classList.remove('hidden');

        const form = new FormData();
        form.append('file', file);

        try {
            const res = await fetch('/api/excel/upload-register', { method: 'POST', body: form });
            const data = await res.json();
            if (data.success) {
                showToast(`✅ Registered ${data.updated} students successfully!`, 'success');
                renderRegUploadResult(data);
                loadStudentTable(); // reload lists
            } else {
                resultDiv.innerHTML = `<div class="upload-result-error"><i data-lucide="alert-circle"></i> ${data.message}</div>`;
                lucide.createIcons();
            }
        } catch(e) {
            resultDiv.innerHTML = `<div class="upload-result-error">Error: ${e.message}</div>`;
        }
    }

    function renderRegUploadResult(data) {
        const div = document.getElementById('reg-upload-result');
        if (!div) return;

        const results = data.results || [];
        const errors = data.errors || [];

        // Group registered students by class-section
        const groups = {};
        results.forEach(s => {
            const key = `${s.class}-${s.section}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(s.name);
        });

        let html = `
            <div class="upload-result-banner success">
                <i data-lucide="check-circle"></i>
                <div>
                    <strong>Successfully registered ${data.updated} students!</strong>
                    <p>Divided class &amp; section wise automatically.</p>
                </div>
            </div>
            <div style="margin-top:1rem; max-height: 250px; overflow-y: auto; background: var(--bg-input); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                <div style="font-weight:700; margin-bottom: 0.5rem; font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted);">
                    Class Division Summary:
                </div>
        `;

        if (Object.keys(groups).length === 0) {
            html += `<p style="color:var(--text-muted);font-size:0.85rem;">No new students registered.</p>`;
        } else {
            Object.entries(groups).forEach(([classSec, names]) => {
                const parts = classSec.split('-');
                const cLabel = ['Nursery','LKG','UKG'].includes(parts[0]) ? parts[0] : (parts[0] === '0' ? 'Class 0' : `Class ${parts[0]}`);
                html += `
                    <div style="margin-bottom: 0.75rem;">
                        <span class="badge badge-primary" style="font-size: 0.75rem; margin-bottom: 0.25rem;">${cLabel} - Section ${parts[1]} (${names.length})</span>
                        <div style="font-size: 0.85rem; color: var(--text-main); line-height: 1.4; padding-left: 0.5rem; border-left: 2px solid var(--primary);">
                            ${names.join(', ')}
                        </div>
                    </div>
                `;
            });
        }

        html += `</div>`;

        if (errors.length) {
            html += `
                <div class="upload-result-errors" style="margin-top:1rem;">
                    <strong>⚠️ Warnings / Skip Logs (${errors.length}):</strong>
                    <ul style="max-height: 150px; overflow-y: auto;">
                        ${errors.map(err => `<li>${err}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        div.innerHTML = html;
        lucide.createIcons();
    }

    // ---- HELPER: Setup Drag & Drop Zone ----
    function setupDropZone(zoneId, inputId, handler) {
        const zone = document.getElementById(zoneId);
        const input = document.getElementById(inputId);
        if (!zone || !input) return;

        zone.addEventListener('click', () => input.click());

        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) handler(file);
        });
    }

}); // end DOMContentLoaded
