document.addEventListener("DOMContentLoaded", function () {
    // ============================================================
    // STATE & GLOBALS
    // ============================================================
    let activeStudentTimetable = null;
    let liveTickerInterval = null;
    let currentStudentId = null;
    let activeStudentObject = null;
    let activeModalStudent = null;
    let currentRole = null;
    let currentTeacherId = null;
    let pendingDeleteId = null;
    let pendingDeleteType = null; // 'student' | 'teacher'
    let pendingPasswordRole = null; // 'teacher' | 'parent'

    let academicChartInstance = null;
    let radarChartInstance = null;
    let overviewRadarChartInstance = null;

    // Core views
    const authView = document.getElementById("auth-view");
    const appNavHeader = document.getElementById("app-nav-header");
    const adminDashboardView = document.getElementById("admin-dashboard-view");
    const dashboardReportPage = document.getElementById("dashboard-report-page");
    const userGreetingLabel = document.getElementById("user-greeting-label");
    const loginErrorMsg = document.getElementById("login-error-msg");

    lucide.createIcons();

    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    document.querySelectorAll(".current-date-str").forEach(el => el.textContent = formattedDate);

    // Set today's date as default in date picker
    const attDateFilter = document.getElementById("att-date-filter");
    if (attDateFilter) attDateFilter.value = today.toISOString().slice(0, 10);

    // Set current month as default in report
    const reportMonth = document.getElementById("report-month");
    if (reportMonth) reportMonth.value = today.toISOString().slice(0, 7);

    // ============================================================
    // SHOW/HIDE PASSWORD TOGGLE
    // ============================================================
    document.addEventListener("click", function (e) {
        const btn = e.target.closest(".show-pwd-btn");
        if (!btn) return;
        const targetId = btn.getAttribute("data-target");
        const input = document.getElementById(targetId);
        if (!input) return;
        const icon = btn.querySelector("i");
        if (input.type === "password") {
            input.type = "text";
            if (icon) { icon.setAttribute("data-lucide", "eye-off"); lucide.createIcons(); }
        } else {
            input.type = "password";
            if (icon) { icon.setAttribute("data-lucide", "eye"); lucide.createIcons(); }
        }
    });

    // ============================================================
    // PHONE VALIDATION HELPER
    // ============================================================
    function cleanPhone(phone) {
        return (phone || "").replace(/[\s\-+]/g, "").replace(/^91/, "");
    }
    function validatePhone(phone) {
        const clean = cleanPhone(phone);
        return clean.length > 0 && clean.length <= 10 && /^\d+$/.test(clean);
    }

    // ============================================================
    // AUTH SESSION
    // ============================================================
    function checkAuthSession() {
        const role = localStorage.getItem("sptas_role");
        const studentId = localStorage.getItem("sptas_student_id");
        const userName = localStorage.getItem("sptas_user_name");
        currentRole = role;

        if (role) {
            authView.classList.add("hidden");
            appNavHeader.classList.remove("hidden");
            userGreetingLabel.textContent = `Logged in as: ${userName || role}`;

            if (role === "parent") {
                loadParentDashboard(studentId);
            } else {
                loadAdminDashboard();
            }
        } else {
            authView.classList.remove("hidden");
            appNavHeader.classList.add("hidden");
            adminDashboardView.classList.add("hidden");
            dashboardReportPage.classList.add("hidden");
        }
    }
    checkAuthSession();

    // ============================================================
    // LOGIN TAB NAVIGATION
    // ============================================================
    const authTabBtns = document.querySelectorAll(".auth-tab-btn");
    const loginForms = document.querySelectorAll(".login-form");

    authTabBtns.forEach(btn => {
        btn.addEventListener("click", function () {
            const role = btn.getAttribute("data-role");
            authTabBtns.forEach(b => b.classList.remove("active"));
            loginForms.forEach(f => f.classList.add("hidden"));
            loginErrorMsg.classList.add("hidden");
            btn.classList.add("active");
            document.getElementById(`${role}-login-form`).classList.remove("hidden");
        });
    });

    function showLoginError(msg) {
        loginErrorMsg.textContent = msg;
        loginErrorMsg.classList.remove("hidden");
    }

    // ============================================================
    // PARENT LOGIN
    // ============================================================
    document.getElementById("parent-login-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        loginErrorMsg.classList.add("hidden");
        const rollNo = document.getElementById("parent-roll").value.trim();
        const phone = document.getElementById("parent-phone").value.trim();
        const password = document.getElementById("parent-pass").value.trim();

        const cleanedPhone = cleanPhone(phone);
        if (cleanedPhone.length > 10) {
            return showLoginError("Phone number must be 10 digits or less.");
        }

        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "parent", roll_no: rollNo, phone_no: phone, password })
        });
        const data = await res.json();

        if (data.success) {
            currentRole = "parent";
            localStorage.setItem("sptas_role", "parent");
            localStorage.setItem("sptas_student_id", data.student_id);
            localStorage.setItem("sptas_user_name", data.name);

            if (data.require_password_setup) {
                showPasswordSetupModal("parent", data.student_id, data.name);
            } else {
                authView.classList.add("hidden");
                appNavHeader.classList.remove("hidden");
                userGreetingLabel.textContent = `Logged in as: ${data.name}`;
                loadParentDashboard(data.student_id);
            }
        } else {
            showLoginError(data.message || "Login failed.");
        }
    });

    // ============================================================
    // TEACHER LOGIN (Phone-based)
    // ============================================================
    document.getElementById("teacher-login-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        loginErrorMsg.classList.add("hidden");
        const phone = document.getElementById("teacher-phone").value.trim();
        const password = document.getElementById("teacher-password").value.trim();

        const cleanedPhone = cleanPhone(phone);
        if (cleanedPhone.length > 10) {
            return showLoginError("Phone number must be 10 digits or less.");
        }

        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "teacher", phone, password })
        });
        const data = await res.json();

        if (data.success) {
            currentRole = "teacher";
            currentTeacherId = data.teacher_id;
            localStorage.setItem("sptas_role", "teacher");
            localStorage.setItem("sptas_teacher_id", data.teacher_id);
            localStorage.setItem("sptas_user_name", data.name);

            if (data.require_password_setup) {
                showPasswordSetupModal("teacher", data.teacher_id, data.name);
            } else {
                proceedToTeacherDashboard(data.name);
            }
        } else {
            showLoginError(data.message || "Login failed.");
        }
    });

    function proceedToTeacherDashboard(name) {
        authView.classList.add("hidden");
        appNavHeader.classList.remove("hidden");
        userGreetingLabel.textContent = `Logged in as: ${name}`;
        document.getElementById("edit-principal-name-btn").classList.add("hidden");
        document.querySelectorAll(".principal-only").forEach(el => el.classList.add("hidden"));
        loadAdminDashboard();
    }

    // ============================================================
    // PRINCIPAL LOGIN
    // ============================================================
    document.getElementById("principal-login-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        loginErrorMsg.classList.add("hidden");
        const username = document.getElementById("principal-username").value.trim();
        const password = document.getElementById("principal-password").value.trim();

        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "principal", username, password })
        });
        const data = await res.json();

        if (data.success) {
            currentRole = "principal";
            localStorage.setItem("sptas_role", "principal");
            localStorage.setItem("sptas_user_name", data.name);

            authView.classList.add("hidden");
            appNavHeader.classList.remove("hidden");
            userGreetingLabel.textContent = `Logged in as: ${data.name}`;
            document.getElementById("edit-principal-name-btn").classList.remove("hidden");
            document.querySelectorAll(".principal-only").forEach(el => el.classList.remove("hidden"));
            loadAdminDashboard();
        } else {
            showLoginError(data.message || "Invalid credentials.");
        }
    });

    // ============================================================
    // PASSWORD SETUP MODAL
    // ============================================================
    function showPasswordSetupModal(role, entityId, name) {
        pendingPasswordRole = { role, entityId, name };
        const overlay = document.getElementById("password-setup-overlay");
        document.getElementById("pwd-setup-title").textContent = role === "teacher" ? "Set Teacher Password" : "Set Parent Password";
        document.getElementById("pwd-setup-desc").textContent = "This is your first login. Please set a password to secure your account.";
        document.getElementById("pwd-setup-input").value = "";
        document.getElementById("pwd-setup-confirm").value = "";
        document.getElementById("pwd-setup-error").classList.add("hidden");
        overlay.classList.remove("hidden");
        lucide.createIcons();
    }

    document.getElementById("pwd-setup-save-btn").addEventListener("click", async function () {
        const newPwd = document.getElementById("pwd-setup-input").value.trim();
        const confirmPwd = document.getElementById("pwd-setup-confirm").value.trim();
        const errEl = document.getElementById("pwd-setup-error");

        if (!newPwd) { errEl.textContent = "Password cannot be empty."; errEl.classList.remove("hidden"); return; }
        if (newPwd !== confirmPwd) { errEl.textContent = "Passwords do not match."; errEl.classList.remove("hidden"); return; }

        const { role, entityId, name } = pendingPasswordRole;
        const endpoint = role === "teacher" ? "/api/teacher/set-password" : "/api/parent/set-password";
        const body = role === "teacher" ? { teacher_id: entityId, password: newPwd } : { student_id: entityId, password: newPwd };

        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (data.success) {
            document.getElementById("password-setup-overlay").classList.add("hidden");
            if (role === "teacher") {
                proceedToTeacherDashboard(name);
            } else {
                const studentId = localStorage.getItem("sptas_student_id");
                authView.classList.add("hidden");
                appNavHeader.classList.remove("hidden");
                userGreetingLabel.textContent = `Logged in as: ${name}`;
                loadParentDashboard(studentId);
            }
        } else {
            errEl.textContent = data.message || "Error setting password.";
            errEl.classList.remove("hidden");
        }
    });

    // ============================================================
    // EDIT PRINCIPAL NAME
    // ============================================================
    document.getElementById("edit-principal-name-btn").addEventListener("click", function () {
        const currentName = localStorage.getItem("sptas_user_name") || "";
        document.getElementById("edit-principal-name-input").value = currentName;
        document.getElementById("edit-name-overlay").classList.remove("hidden");
    });
    document.getElementById("edit-name-close").addEventListener("click", () => document.getElementById("edit-name-overlay").classList.add("hidden"));
    document.getElementById("edit-name-cancel").addEventListener("click", () => document.getElementById("edit-name-overlay").classList.add("hidden"));
    document.getElementById("edit-name-save").addEventListener("click", async function () {
        const newName = document.getElementById("edit-principal-name-input").value.trim();
        if (!newName) return;
        const res = await fetch("/api/settings/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ principal_name: newName })
        });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem("sptas_user_name", newName);
            userGreetingLabel.textContent = `Logged in as: ${newName}`;
            document.getElementById("edit-name-overlay").classList.add("hidden");
        }
    });

    // ============================================================
    // THEME TOGGLE
    // ============================================================
    const themeToggleBtn = document.getElementById("theme-toggle-btn");
    const htmlEl = document.documentElement;

    function applyTheme(theme) {
        htmlEl.setAttribute("data-theme", theme);
        localStorage.setItem("sptas_theme", theme);
        if (theme === "dark") {
            document.querySelector(".theme-icon-dark")?.classList.add("hidden");
            document.querySelector(".theme-icon-light")?.classList.remove("hidden");
        } else {
            document.querySelector(".theme-icon-dark")?.classList.remove("hidden");
            document.querySelector(".theme-icon-light")?.classList.add("hidden");
        }
    }
    const savedTheme = localStorage.getItem("sptas_theme") || "light";
    applyTheme(savedTheme);
    themeToggleBtn?.addEventListener("click", () => {
        applyTheme(htmlEl.getAttribute("data-theme") === "light" ? "dark" : "light");
    });

    // ============================================================
    // LOGOUT
    // ============================================================
    document.getElementById("logout-btn").addEventListener("click", function () {
        if (liveTickerInterval) clearInterval(liveTickerInterval);
        localStorage.removeItem("sptas_role");
        localStorage.removeItem("sptas_student_id");
        localStorage.removeItem("sptas_user_name");
        localStorage.removeItem("sptas_teacher_id");
        currentRole = null;
        authView.classList.remove("hidden");
        appNavHeader.classList.add("hidden");
        adminDashboardView.classList.add("hidden");
        dashboardReportPage.classList.add("hidden");
        document.getElementById("edit-principal-name-btn").classList.add("hidden");
    });

    // ============================================================
    // ADMIN PORTAL TABS
    // ============================================================
    document.querySelectorAll(".admin-tab-pill").forEach(btn => {
        btn.addEventListener("click", function () {
            const tabId = btn.getAttribute("data-admin-tab");
            document.querySelectorAll(".admin-tab-pill").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".admin-tab-content").forEach(c => c.classList.add("hidden"));
            btn.classList.add("active");
            document.getElementById(tabId).classList.remove("hidden");

            if (tabId === "tab-teachers") loadTeachersTable();
            if (tabId === "tab-attendance") populateAttendanceClassFilter();
            if (tabId === "tab-reports") populateReportClassFilter();
        });
    });

    // ============================================================
    // LOAD ADMIN DASHBOARD
    // ============================================================
    async function loadAdminDashboard() {
        if (liveTickerInterval) clearInterval(liveTickerInterval);
        dashboardReportPage.classList.add("hidden");
        adminDashboardView.classList.remove("hidden");

        // Show/hide principal-only elements
        const isPrincipal = localStorage.getItem("sptas_role") === "principal";
        const editNameBtn = document.getElementById("edit-principal-name-btn");
        if (isPrincipal) {
            editNameBtn?.classList.remove("hidden");
            document.querySelectorAll(".principal-only").forEach(el => el.classList.remove("hidden"));
        } else {
            editNameBtn?.classList.add("hidden");
            document.querySelectorAll(".principal-only").forEach(el => el.classList.add("hidden"));
        }

        // Load stats
        try {
            const res = await fetch("/api/stats");
            const stats = await res.json();
            document.getElementById("admin-stat-students").textContent = stats.total_students;
            document.getElementById("admin-stat-attendance").textContent = stats.overall_attendance;
            document.getElementById("admin-stat-classes").textContent = stats.active_classes;
            document.getElementById("admin-stat-teachers").textContent = stats.teachers;
        } catch {}

        // Populate class filters
        populateClassFilters();
        loadStudentTable();
        lucide.createIcons();
    }

    async function populateClassFilters() {
        const classes = [];
        for (let i = 1; i <= 10; i++) classes.push(String(i));

        ["filter-class", "att-class-filter", "report-class"].forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const firstOpt = sel.options[0];
            sel.innerHTML = "";
            if (firstOpt) sel.add(new Option(firstOpt.text, firstOpt.value));
            classes.forEach(c => sel.add(new Option(`Class ${c}`, c)));
        });
    }

    function populateAttendanceClassFilter() { populateClassFilters(); }
    function populateReportClassFilter() { populateClassFilters(); }

    // ============================================================
    // STUDENT TABLE
    // ============================================================
    let allStudents = [];

    async function loadStudentTable(query = "", classFilter = "", sectionFilter = "") {
        let url = `/api/search?q=${encodeURIComponent(query)}`;
        if (classFilter) url += `&class=${classFilter}`;
        if (sectionFilter) url += `&section=${sectionFilter}`;

        const res = await fetch(url);
        allStudents = await res.json();

        const tbody = document.querySelector("#admin-students-table tbody");
        const badge = document.getElementById("students-count-badge");
        badge.textContent = `${allStudents.length} Student${allStudents.length !== 1 ? "s" : ""}`;
        tbody.innerHTML = "";

        if (allStudents.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted);">No students found.</td></tr>`;
            return;
        }

        allStudents.forEach(s => {
            const attStatus = s.attendance_status === "Absent"
                ? '<span style="color:#dc2626;font-weight:600;">⚫ Absent</span>'
                : '<span style="color:#16a34a;font-weight:600;">🟢 Present</span>';
            const trendBadge = s.trend === "Improving"
                ? `<span class="badge badge-improving">↑ Improving</span>`
                : s.trend === "Declining"
                ? `<span class="badge badge-declining">↓ Declining</span>`
                : `<span class="badge badge-stable">→ Stable</span>`;
            const feedback = s.parent_feedback
                ? `<span class="badge" style="background:#fef3c7;color:#92400e;">Feedback Pending Reply</span>`
                : `<span style="color:var(--text-muted);font-size:0.8rem;">No Feedback</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${s.roll_no}</strong></td>
                <td>${s.name}</td>
                <td style="font-size:0.8rem;">${s.admission_no || '—'}</td>
                <td><span class="badge badge-stable">${s.class}-${s.section}</span></td>
                <td>${attStatus}<br><small style="color:var(--text-muted);">${s.attendance}%</small></td>
                <td>${trendBadge}</td>
                <td style="font-size:0.8rem;">${s.parent_name}<br><span style="color:var(--text-muted);">${s.parent_contact}</span></td>
                <td>${feedback}</td>
                <td style="text-align:center;">
                    <div style="display:flex;gap:0.4rem;justify-content:center;flex-wrap:wrap;">
                        <button class="btn-action btn-view" onclick="viewStudent('${s.id}')" title="View Report"><i data-lucide="eye"></i></button>
                        <button class="btn-action btn-edit" onclick="editStudent('${s.id}')" title="Edit"><i data-lucide="pencil"></i></button>
                        <button class="btn-action btn-delete" onclick="requestDeleteStudent('${s.id}','${s.name.replace(/'/g,'')}')" title="Delete"><i data-lucide="trash-2"></i></button>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    }

    // Search & filter
    const adminSearchInput = document.getElementById("admin-search-input");
    adminSearchInput?.addEventListener("input", debounce(function () {
        const classF = document.getElementById("filter-class")?.value || "";
        const sectionF = document.getElementById("filter-section")?.value || "";
        loadStudentTable(adminSearchInput.value.trim(), classF, sectionF);
    }, 350));

    document.getElementById("filter-class")?.addEventListener("change", function () {
        const sectionF = document.getElementById("filter-section")?.value || "";
        loadStudentTable(adminSearchInput?.value.trim() || "", this.value, sectionF);
    });
    document.getElementById("filter-section")?.addEventListener("change", function () {
        const classF = document.getElementById("filter-class")?.value || "";
        loadStudentTable(adminSearchInput?.value.trim() || "", classF, this.value);
    });

    // Debounce helper
    function debounce(fn, delay) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }

    // ============================================================
    // DELETE STUDENT — with confirmation modal
    // ============================================================
    window.requestDeleteStudent = function (id, name) {
        pendingDeleteId = id;
        pendingDeleteType = "student";
        document.getElementById("confirm-delete-title").textContent = `Delete Student?`;
        document.getElementById("confirm-delete-msg").textContent = `Are you sure you want to permanently delete "${name}"? This cannot be undone.`;
        document.getElementById("confirm-delete-overlay").classList.remove("hidden");
        lucide.createIcons();
    };

    document.getElementById("confirm-delete-cancel").addEventListener("click", () => {
        document.getElementById("confirm-delete-overlay").classList.add("hidden");
        pendingDeleteId = null;
        pendingDeleteType = null;
    });

    document.getElementById("confirm-delete-ok").addEventListener("click", async function () {
        if (!pendingDeleteId) return;
        const overlay = document.getElementById("confirm-delete-overlay");
        overlay.classList.add("hidden");

        if (pendingDeleteType === "student") {
            const res = await fetch(`/api/admin/student/delete/${pendingDeleteId}`, { method: "POST" });
            const data = await res.json();
            if (data.success) {
                showToast("Student deleted successfully.", "success");
                loadStudentTable();
            } else {
                showToast(data.message || "Failed to delete.", "error");
            }
        } else if (pendingDeleteType === "teacher") {
            const res = await fetch(`/api/teacher/delete/${pendingDeleteId}`, { method: "POST" });
            const data = await res.json();
            if (data.success) {
                showToast("Teacher deleted.", "success");
                loadTeachersTable();
            } else {
                showToast(data.message || "Failed.", "error");
            }
        }
        pendingDeleteId = null;
        pendingDeleteType = null;
    });

    // ============================================================
    // TEACHERS TABLE
    // ============================================================
    async function loadTeachersTable() {
        const res = await fetch("/api/teachers");
        const teachers = await res.json();
        const tbody = document.getElementById("teachers-table-body");
        tbody.innerHTML = "";

        if (teachers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">No teachers found.</td></tr>`;
            return;
        }

        teachers.forEach(t => {
            const attBadge = t.attendance_status === "Present"
                ? `<span class="badge" style="background:#dcfce7;color:#166534;cursor:pointer;" onclick="toggleTeacherAtt('${t.id}','Absent')">🟢 Present</span>`
                : `<span class="badge" style="background:#fee2e2;color:#991b1b;cursor:pointer;" onclick="toggleTeacherAtt('${t.id}','Present')">🔴 Absent</span>`;
            const pwdBadge = t.has_password
                ? `<span class="badge" style="background:#dcfce7;color:#166534;">Set</span>`
                : `<span class="badge" style="background:#fef3c7;color:#92400e;">Not Set</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${t.name}</strong></td>
                <td>${t.phone}</td>
                <td>${(t.subjects || []).join(", ") || "—"}</td>
                <td>${t.class ? `${t.class}-${t.section || ""}` : "—"}</td>
                <td>${attBadge}</td>
                <td>${pwdBadge}</td>
                <td style="text-align:center;">
                    <div style="display:flex;gap:0.4rem;justify-content:center;">
                        <button class="btn-action btn-edit" onclick="openEditTeacher('${t.id}')" title="Edit"><i data-lucide="pencil"></i></button>
                        <button class="btn-action btn-delete" onclick="requestDeleteTeacher('${t.id}','${t.name.replace(/'/g,'')}')" title="Delete"><i data-lucide="trash-2"></i></button>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    }

    window.toggleTeacherAtt = async function (teacherId, newStatus) {
        const res = await fetch("/api/teacher/attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teacher_id: teacherId, status: newStatus })
        });
        const data = await res.json();
        if (data.success) loadTeachersTable();
    };

    window.requestDeleteTeacher = function (id, name) {
        pendingDeleteId = id;
        pendingDeleteType = "teacher";
        document.getElementById("confirm-delete-title").textContent = "Delete Teacher?";
        document.getElementById("confirm-delete-msg").textContent = `Are you sure you want to permanently delete "${name}"?`;
        document.getElementById("confirm-delete-overlay").classList.remove("hidden");
        lucide.createIcons();
    };

    // ============================================================
    // TEACHER MODAL (Add/Edit)
    // ============================================================
    let allTeachersCache = [];

    document.getElementById("add-teacher-btn")?.addEventListener("click", openAddTeacher);

    function openAddTeacher() {
        document.getElementById("teacher-modal-title").textContent = "Add New Teacher";
        document.getElementById("teacher-form-id").value = "";
        document.getElementById("tf-name").value = "";
        document.getElementById("tf-phone").value = "";
        document.getElementById("tf-email").value = "";
        document.getElementById("tf-subjects").value = "";
        document.getElementById("tf-class").value = "";
        document.getElementById("tf-section").value = "";
        document.getElementById("teacher-form-error").classList.add("hidden");
        document.getElementById("teacher-modal-overlay").classList.remove("hidden");
        lucide.createIcons();
    }

    window.openEditTeacher = async function (teacherId) {
        const res = await fetch("/api/teachers");
        const teachers = await res.json();
        const t = teachers.find(x => x.id === teacherId);
        if (!t) return;

        document.getElementById("teacher-modal-title").textContent = "Edit Teacher";
        document.getElementById("teacher-form-id").value = t.id;
        document.getElementById("tf-name").value = t.name;
        document.getElementById("tf-phone").value = t.phone;
        document.getElementById("tf-email").value = t.email || "";
        document.getElementById("tf-subjects").value = (t.subjects || []).join(", ");
        document.getElementById("tf-class").value = t.class || "";
        document.getElementById("tf-section").value = t.section || "";
        document.getElementById("teacher-form-error").classList.add("hidden");
        document.getElementById("teacher-modal-overlay").classList.remove("hidden");
        lucide.createIcons();
    };

    document.getElementById("teacher-modal-close")?.addEventListener("click", closeTeacherModal);
    document.getElementById("teacher-modal-cancel")?.addEventListener("click", closeTeacherModal);
    function closeTeacherModal() {
        document.getElementById("teacher-modal-overlay").classList.add("hidden");
    }

    document.getElementById("teacher-form")?.addEventListener("submit", async function (e) {
        e.preventDefault();
        const errEl = document.getElementById("teacher-form-error");
        const id = document.getElementById("teacher-form-id").value;
        const phone = document.getElementById("tf-phone").value.trim();

        if (!validatePhone(phone)) {
            errEl.textContent = "Phone number must be 10 digits or less.";
            errEl.classList.remove("hidden"); return;
        }

        const body = {
            name: document.getElementById("tf-name").value.trim(),
            phone: cleanPhone(phone),
            email: document.getElementById("tf-email").value.trim(),
            subjects: document.getElementById("tf-subjects").value.split(",").map(s => s.trim()).filter(s => s),
            class: document.getElementById("tf-class").value,
            section: document.getElementById("tf-section").value
        };

        const url = id ? `/api/teacher/update/${id}` : "/api/teacher/create";
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.success) {
            closeTeacherModal();
            showToast(id ? "Teacher updated." : "Teacher added.", "success");
            loadTeachersTable();
        } else {
            errEl.textContent = data.message || "Error.";
            errEl.classList.remove("hidden");
        }
    });

    // ============================================================
    // ATTENDANCE PORTAL
    // ============================================================
    document.getElementById("att-load-btn")?.addEventListener("click", loadAttendanceList);

    async function loadAttendanceList() {
        const cls = document.getElementById("att-class-filter").value;
        const section = document.getElementById("att-section-filter").value;
        const date = document.getElementById("att-date-filter").value;

        if (!cls) { showToast("Please select a class.", "error"); return; }
        if (!date) { showToast("Please select a date.", "error"); return; }

        const res = await fetch(`/api/attendance/class?class=${cls}&section=${section}&date=${date}`);
        const students = await res.json();

        const container = document.getElementById("attendance-list-container");
        const saveBtn = document.getElementById("att-save-btn");

        if (students.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:2rem;">No students found for Class ${cls}${section ? "-" + section : ""}.</p>`;
            saveBtn.style.display = "none";
            return;
        }

        saveBtn.style.display = "";
        let html = `
            <div style="display:flex;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="markAllAttendance('Present')">✅ Mark All Present</button>
                <button class="btn btn-secondary" onclick="markAllAttendance('Absent')">❌ Mark All Absent</button>
            </div>
            <div class="table-container">
            <table class="data-table">
                <thead><tr>
                    <th>#</th><th>Roll No</th><th>Student Name</th>
                    <th>Full Day Present</th><th>Half Day</th><th>Absent</th>
                </tr></thead>
                <tbody>`;

        students.forEach((s, i) => {
            const isPresent = s.attendance_status === "Present";
            const isHalf = s.attendance_status === "Half Day";
            const isAbsent = s.attendance_status === "Absent";

            html += `<tr id="att-row-${s.id}" data-student-id="${s.id}">
                <td>${i + 1}</td>
                <td><strong>${s.roll_no}</strong></td>
                <td>${s.name}</td>
                <td style="text-align:center;">
                    <input type="radio" name="att_${s.id}" value="Present" ${isPresent ? "checked" : ""}
                        onchange="updateAttendanceRow('${s.id}', 'Present')">
                </td>
                <td style="text-align:center;">
                    <input type="radio" name="att_${s.id}" value="Half Day" ${isHalf ? "checked" : ""}
                        onchange="updateAttendanceRow('${s.id}', 'Half Day')">
                </td>
                <td style="text-align:center;">
                    <input type="radio" name="att_${s.id}" value="Absent" ${isAbsent ? "checked" : ""}
                        onchange="updateAttendanceRow('${s.id}', 'Absent')">
                </td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        container.innerHTML = html;
        lucide.createIcons();
    }

    window.updateAttendanceRow = function (studentId, status) {
        const row = document.getElementById(`att-row-${studentId}`);
        if (!row) return;
        row.style.background = status === "Absent" ? "#fff1f2" : status === "Half Day" ? "#fffbeb" : "";
    };

    window.markAllAttendance = function (status) {
        document.querySelectorAll("[data-student-id]").forEach(row => {
            const sid = row.getAttribute("data-student-id");
            const radio = row.querySelector(`input[value="${status}"]`);
            if (radio) { radio.checked = true; updateAttendanceRow(sid, status); }
        });
    };

    document.getElementById("att-save-btn")?.addEventListener("click", async function () {
        const date = document.getElementById("att-date-filter").value;
        const records = [];

        document.querySelectorAll("[data-student-id]").forEach(row => {
            const sid = row.getAttribute("data-student-id");
            const checked = row.querySelector("input[type='radio']:checked");
            if (checked) records.push({ student_id: sid, status: checked.value });
        });

        if (records.length === 0) { showToast("No attendance data.", "error"); return; }

        const res = await fetch("/api/attendance/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date, records })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Attendance saved for ${data.updated} students.`, "success");
        } else {
            showToast("Failed to save attendance.", "error");
        }
    });

    // ============================================================
    // TIMETABLE MANAGER
    // ============================================================
    let currentTimetableData = {};
    let currentTimetableKey = "";

    document.getElementById("tt-load-btn")?.addEventListener("click", loadTimetableEditor);

    async function loadTimetableEditor() {
        const cls = document.getElementById("tt-class-select").value;
        const section = document.getElementById("tt-section-select").value;
        if (!cls) { showToast("Please select a class.", "error"); return; }

        currentTimetableKey = `${cls}-${section}`;
        const res = await fetch(`/api/timetable/${currentTimetableKey}`);
        const data = await res.json();

        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const emptyDay = () => [
            { period: "1", time: "08:30 AM - 09:30 AM", subject: "", teacher: "", room: "", status: "Class In Progress" },
            { period: "Recess", time: "10:30 AM - 10:45 AM", subject: "Break Time", teacher: "-", room: "Courtyard", status: "Recess" },
            { period: "2", time: "10:45 AM - 11:45 AM", subject: "", teacher: "", room: "", status: "Class In Progress" },
            { period: "Lunch", time: "12:45 PM - 01:30 PM", subject: "Lunch Break", teacher: "-", room: "Cafeteria", status: "Break" },
            { period: "3", time: "01:30 PM - 02:30 PM", subject: "", teacher: "", room: "", status: "Class In Progress" }
        ];

        currentTimetableData = data.timetable || {};
        days.forEach(d => { if (!currentTimetableData[d]) currentTimetableData[d] = emptyDay(); });

        renderTimetableEditor();
        document.getElementById("tt-save-btn").style.display = "";
        document.getElementById("tt-save-btn").textContent = `💾 Save & Apply to Class ${cls}-${section}`;
    }

    function renderTimetableEditor() {
        const container = document.getElementById("timetable-editor-container");
        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

        let html = `<div class="timetable-days-tabs">`;
        days.forEach((d, i) => {
            html += `<button class="tt-day-btn ${i === 0 ? 'active' : ''}" data-day="${d}" onclick="switchTTDay('${d}', this)">${d.slice(0, 3)}</button>`;
        });
        html += `</div><div id="tt-day-editor" style="margin-top:1rem;"></div>`;
        container.innerHTML = html;
        renderTTDayEditor("Monday");
        lucide.createIcons();
    }

    window.switchTTDay = function (day, btn) {
        document.querySelectorAll(".tt-day-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        saveTTDayToMemory();
        renderTTDayEditor(day);
    };

    let currentEditingDay = "Monday";
    function renderTTDayEditor(day) {
        currentEditingDay = day;
        const periods = currentTimetableData[day] || [];
        const editor = document.getElementById("tt-day-editor");

        let html = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                <h4 style="font-weight:600;">${day} Schedule</h4>
                <button class="btn btn-secondary" onclick="addPeriodRow('${day}')"><i data-lucide="plus"></i> Add Period</button>
            </div>
            <div class="table-container">
            <table class="data-table" id="tt-periods-table">
            <thead><tr>
                <th>Period</th><th>Time (Start - End)</th><th>Subject</th>
                <th>Teacher</th><th>Room</th><th>Type</th><th>Del</th>
            </tr></thead>
            <tbody>`;

        periods.forEach((p, idx) => {
            const isBreak = p.status === "Recess" || p.status === "Break";
            html += `
            <tr>
                <td><input type="text" class="form-input tt-period-no" value="${p.period}" style="width:60px;" ${isBreak ? "readonly" : ""}></td>
                <td><input type="text" class="form-input tt-period-time" value="${p.time}" style="width:200px;"></td>
                <td><input type="text" class="form-input tt-period-subject" value="${p.subject}" ${isBreak ? "readonly" : ""}></td>
                <td><input type="text" class="form-input tt-period-teacher" value="${p.teacher}" ${isBreak ? "readonly" : ""}></td>
                <td><input type="text" class="form-input tt-period-room" value="${p.room}"></td>
                <td>
                    <select class="form-select tt-period-status" style="width:140px;">
                        <option ${p.status === "Class In Progress" ? "selected" : ""}>Class In Progress</option>
                        <option ${p.status === "Recess" ? "selected" : ""}>Recess</option>
                        <option ${p.status === "Break" ? "selected" : ""}>Break</option>
                        <option ${p.status === "Free Period" ? "selected" : ""}>Free Period</option>
                    </select>
                </td>
                <td><button class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        editor.innerHTML = html;
        lucide.createIcons();
    }

    window.addPeriodRow = function (day) {
        const tbody = document.querySelector("#tt-periods-table tbody");
        if (!tbody) return;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><input type="text" class="form-input tt-period-no" value="P" style="width:60px;"></td>
            <td><input type="text" class="form-input tt-period-time" value="00:00 AM - 00:00 AM" style="width:200px;"></td>
            <td><input type="text" class="form-input tt-period-subject" value=""></td>
            <td><input type="text" class="form-input tt-period-teacher" value=""></td>
            <td><input type="text" class="form-input tt-period-room" value=""></td>
            <td>
                <select class="form-select tt-period-status" style="width:140px;">
                    <option>Class In Progress</option><option>Recess</option>
                    <option>Break</option><option>Free Period</option>
                </select>
            </td>
            <td><button class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>`;
        tbody.appendChild(row);
        lucide.createIcons();
    };

    function saveTTDayToMemory() {
        const rows = document.querySelectorAll("#tt-periods-table tbody tr");
        const periods = [];
        rows.forEach(row => {
            periods.push({
                period: row.querySelector(".tt-period-no")?.value || "",
                time: row.querySelector(".tt-period-time")?.value || "",
                subject: row.querySelector(".tt-period-subject")?.value || "",
                teacher: row.querySelector(".tt-period-teacher")?.value || "",
                room: row.querySelector(".tt-period-room")?.value || "",
                status: row.querySelector(".tt-period-status")?.value || "Class In Progress"
            });
        });
        currentTimetableData[currentEditingDay] = periods;
    }

    document.getElementById("tt-save-btn")?.addEventListener("click", async function () {
        saveTTDayToMemory();
        const res = await fetch("/api/timetable/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ class_key: currentTimetableKey, timetable: currentTimetableData })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Timetable saved and applied to Class ${currentTimetableKey}.`, "success");
        } else {
            showToast("Failed to save timetable.", "error");
        }
    });

    // ============================================================
    // MONTHLY REPORTS
    // ============================================================
    document.getElementById("report-load-btn")?.addEventListener("click", generateMonthlyReport);

    async function generateMonthlyReport() {
        const month = document.getElementById("report-month").value;
        const cls = document.getElementById("report-class").value;
        const section = document.getElementById("report-section").value;

        if (!month) { showToast("Please select a month.", "error"); return; }

        let url = `/api/attendance/report?month=${month}`;
        if (cls) url += `&class=${cls}`;
        if (section) url += `&section=${section}`;

        const res = await fetch(url);
        const report = await res.json();
        const container = document.getElementById("monthly-report-container");

        if (report.length === 0) {
            container.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:2rem;">No attendance data found for this period.</p>`;
            return;
        }

        const [year, monthNum] = month.split("-");
        const monthName = new Date(year, parseInt(monthNum) - 1, 1).toLocaleString("default", { month: "long" });

        let html = `
        <div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
            <h4 style="font-weight:600;">Attendance Report — ${monthName} ${year}</h4>
            <span class="badge badge-stable">${report.length} Students</span>
        </div>
        <div class="table-container">
        <table class="data-table">
        <thead><tr>
            <th>#</th><th>Name</th><th>Class</th><th>Roll No</th>
            <th>Present Days</th><th>Half Days</th><th>Absent Days</th><th>Total Days</th><th>Attendance %</th>
        </tr></thead><tbody>`;

        report.forEach((r, i) => {
            const pct = r.percentage;
            const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
            html += `<tr>
                <td>${i + 1}</td>
                <td><strong>${r.name}</strong></td>
                <td>${r.class}-${r.section}</td>
                <td>${r.roll_no}</td>
                <td style="color:#16a34a;font-weight:600;">${r.present_days}</td>
                <td style="color:#d97706;">${r.half_days}</td>
                <td style="color:#dc2626;font-weight:600;">${r.absent_days}</td>
                <td>${r.total_days}</td>
                <td><strong style="color:${color};">${pct}%</strong></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;
        lucide.createIcons();
    }

    // ============================================================
    // VIEW STUDENT (Report Card)
    // ============================================================
    window.viewStudent = async function (studentId) {
        const res = await fetch(`/api/student/${studentId}`);
        const student = await res.json();
        if (student.error) return;
        activeStudentObject = student;
        currentStudentId = studentId;
        renderStudentDashboard(student, false);
    };

    // ============================================================
    // PARENT DASHBOARD LOAD
    // ============================================================
    async function loadParentDashboard(studentId) {
        if (!studentId) return;
        const res = await fetch(`/api/student/${studentId}`);
        const student = await res.json();
        if (student.error) return;
        activeStudentObject = student;
        currentStudentId = studentId;
        document.getElementById("parent-settings-btn")?.classList.remove("hidden");
        renderStudentDashboard(student, true);
    }

    // ============================================================
    // RENDER STUDENT DASHBOARD
    // ============================================================
    function renderStudentDashboard(student, isParent) {
        if (liveTickerInterval) clearInterval(liveTickerInterval);

        adminDashboardView.classList.add("hidden");
        dashboardReportPage.classList.remove("hidden");

        // Profile fields
        const nameEl = document.getElementById("profile-name");
        if (nameEl) nameEl.textContent = student.name;
        document.querySelectorAll(".student-first-name").forEach(el => el.textContent = student.name.split(" ")[0]);
        setEl("profile-admission-no", student.admission_no || "—");
        setEl("profile-roll-no", student.roll_no);
        setEl("profile-class-section", `${student.class}-${student.section}`);
        setEl("profile-academic-year", student.academic_year);
        setEl("profile-dob", formatDate(student.dob));
        setEl("profile-parent-name", student.parent_name);
        setEl("profile-parent-contact", student.parent_contact);
        setEl("profile-parent-alt", student.parent_alt_contact || "—");
        document.querySelectorAll(".student-academic-year-print").forEach(el => el.textContent = student.academic_year);

        // Trend badge
        const trendBadge = document.getElementById("profile-trend-badge");
        if (trendBadge) {
            trendBadge.textContent = student.performance_trend;
            trendBadge.className = `status-badge ${student.performance_trend === "Improving" ? "badge-improving" : student.performance_trend === "Declining" ? "badge-declining" : "badge-stable"}`;
        }
        document.querySelectorAll(".student-trend-description").forEach(el => el.textContent = student.performance_trend);

        // Attendance ring
        const att = student.current_status?.attendance_percentage || 0;
        setEl("attendance-percent", `${att}%`);
        const ring = document.getElementById("attendance-ring");
        if (ring) {
            const circumference = 251.2;
            const offset = circumference - (att / 100) * circumference;
            ring.style.strokeDashoffset = offset;
            ring.style.stroke = att >= 75 ? "var(--primary)" : att >= 50 ? "#f59e0b" : "#ef4444";
        }
        setEl("attendance-status-txt", att >= 90 ? "Excellent standing" : att >= 75 ? "Good standing" : att >= 50 ? "Needs attention" : "Critical - Contact school");
        setEl("live-student-attendance-status", student.attendance_status || "Present");

        // Live classroom ticker
        activeStudentTimetable = student.timetable || {};
        updateLiveClassroom(student.timetable);
        liveTickerInterval = setInterval(() => updateLiveClassroom(student.timetable), 60000);

        // Render overview charts
        renderOverview(student);
        renderAcademics(student);
        renderBehavior(student);
        renderActivities(student);
        renderMeetings(student);

        // Parent feedback
        if (isParent) {
            renderParentFeedback(student);
        }

        document.querySelector(".back-to-admin-row") && null;
        lucide.createIcons();
    }

    function setEl(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }
    function formatDate(dateStr) {
        if (!dateStr) return "—";
        try {
            return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
        } catch { return dateStr; }
    }

    // ============================================================
    // LIVE CLASSROOM TICKER
    // ============================================================
    function updateLiveClassroom(timetable) {
        const now = new Date();
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const today = dayNames[now.getDay()];
        const daySchedule = timetable?.[today] || [];

        const nowMins = now.getHours() * 60 + now.getMinutes();

        let currentPeriod = null;
        for (const period of daySchedule) {
            const [startStr, endStr] = (period.time || "").split(" - ");
            const startMins = parseTime(startStr);
            const endMins = parseTime(endStr);
            if (startMins !== null && endMins !== null && nowMins >= startMins && nowMins < endMins) {
                currentPeriod = period;
                break;
            }
        }

        setEl("live-clock", now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));

        if (currentPeriod) {
            setEl("live-period", currentPeriod.period);
            setEl("live-subject", currentPeriod.subject);
            setEl("live-teacher", currentPeriod.teacher);
            setEl("live-room", currentPeriod.room);
            setEl("live-status", currentPeriod.status);
        } else {
            const isWeekend = now.getDay() === 0 || now.getDay() === 6;
            setEl("live-period", "—");
            setEl("live-subject", isWeekend ? "Weekend" : "School Hours Over / Not Started");
            setEl("live-teacher", "—");
            setEl("live-room", "—");
            setEl("live-status", isWeekend ? "Weekend" : "No Active Period");
        }
    }

    function parseTime(timeStr) {
        if (!timeStr) return null;
        const cleaned = timeStr.trim().toUpperCase();
        const match = cleaned.match(/^(\d+):(\d+)\s*(AM|PM)$/);
        if (!match) return null;
        let h = parseInt(match[1]);
        const m = parseInt(match[2]);
        const ampm = match[3];
        if (ampm === "PM" && h !== 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        return h * 60 + m;
    }

    // ============================================================
    // OVERVIEW TAB
    // ============================================================
    function renderOverview(student) {
        // Subject-wise performance chart
        const perf = student.subject_performance || [];
        const ctx = document.getElementById("overview-radar-chart");
        if (ctx && perf.length > 0) {
            if (overviewRadarChartInstance) overviewRadarChartInstance.destroy();
            overviewRadarChartInstance = new Chart(ctx, {
                type: "radar",
                data: {
                    labels: perf.map(p => p.subject),
                    datasets: [{
                        label: "Score",
                        data: perf.map(p => p.score),
                        fill: true,
                        backgroundColor: "rgba(99,102,241,0.15)",
                        borderColor: "rgba(99,102,241,1)",
                        pointBackgroundColor: "rgba(99,102,241,1)"
                    }]
                },
                options: { scales: { r: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
            });
        }

        // Current term marks
        renderCurrentTermMarks(student);

        // Remarks
        renderTermRemarks(student);
    }

    function renderCurrentTermMarks(student) {
        const container = document.getElementById("current-term-marks-list");
        if (!container) return;
        const progress = student.examination_progress || [];
        const latest = progress[progress.length - 1];
        if (!latest || !latest.subjects) { container.innerHTML = `<p style="color:var(--text-muted);">No marks recorded.</p>`; return; }
        let html = "";
        latest.subjects.forEach(sub => {
            const pct = ((sub.obtained / sub.max) * 100).toFixed(0);
            const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
            html += `<div class="marks-bar-row">
                <span class="marks-subject-name">${sub.name}</span>
                <div class="marks-bar-bg"><div class="marks-bar-fill" style="width:${pct}%;background:${color};"></div></div>
                <span class="marks-score" style="color:${color};">${sub.obtained}/${sub.max}</span>
            </div>`;
        });
        container.innerHTML = html;
    }

    function renderTermRemarks(student) {
        const container = document.getElementById("term-remarks-list");
        if (!container) return;
        const remarks = student.teacher_term_remarks || [];
        if (remarks.length === 0) { container.innerHTML = `<p style="color:var(--text-muted);">No remarks recorded.</p>`; return; }
        let html = "";
        remarks.forEach(r => {
            html += `<div class="remark-item">
                <div class="remark-header">
                    <span class="remark-teacher">${r.teacher_name || "Teacher"}</span>
                    <span class="remark-subject">${r.subject || ""}</span>
                    <span class="remark-date">${r.date || ""}</span>
                </div>
                <p class="remark-text">${r.remark}</p>
            </div>`;
        });
        container.innerHTML = html;
    }

    // ============================================================
    // ACADEMICS TAB
    // ============================================================
    function renderAcademics(student) {
        const ctx = document.getElementById("academic-history-chart");
        if (ctx) {
            if (academicChartInstance) academicChartInstance.destroy();
            const progress = student.examination_progress || [];
            if (progress.length > 0) {
                const labels = progress.map(p => p.exam_name || p.exam || "Exam");
                const data = progress.map(p => {
                    if (typeof p.percentage === "number") return p.percentage;
                    if (p.subjects) {
                        const total = p.subjects.reduce((s, sub) => s + sub.obtained, 0);
                        const max = p.subjects.reduce((s, sub) => s + sub.max, 0);
                        return max > 0 ? parseFloat(((total / max) * 100).toFixed(1)) : 0;
                    }
                    return 0;
                });
                academicChartInstance = new Chart(ctx, {
                    type: "line",
                    data: {
                        labels,
                        datasets: [{
                            label: "Percentage",
                            data,
                            borderColor: "rgb(99,102,241)",
                            backgroundColor: "rgba(99,102,241,0.1)",
                            tension: 0.4,
                            fill: true,
                            pointRadius: 5,
                            pointHoverRadius: 7
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: { y: { min: 0, max: 100 } },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        // Exam history table
        renderExamHistoryTable(student);
    }

    function renderExamHistoryTable(student) {
        const container = document.getElementById("exam-history-table-container");
        if (!container) return;
        const progress = student.examination_progress || [];
        if (progress.length === 0) { container.innerHTML = `<p style="color:var(--text-muted);">No exam records found.</p>`; return; }

        let html = "";
        progress.forEach(exam => {
            html += `<div style="margin-bottom:1.5rem;">
                <h4 style="font-weight:600;margin-bottom:0.5rem;">${exam.exam_name || exam.exam || "Exam"} ${exam.year || ""}</h4>
                <div class="table-container"><table class="data-table"><thead><tr>
                    <th>Subject</th><th>Obtained</th><th>Max Marks</th><th>Grade</th>
                </tr></thead><tbody>`;
            (exam.subjects || []).forEach(sub => {
                const pct = ((sub.obtained / sub.max) * 100).toFixed(0);
                const grade = pct >= 90 ? "A+" : pct >= 80 ? "A" : pct >= 70 ? "B+" : pct >= 60 ? "B" : pct >= 50 ? "C" : "F";
                html += `<tr>
                    <td>${sub.name}</td>
                    <td><strong>${sub.obtained}</strong></td>
                    <td>${sub.max}</td>
                    <td><span class="badge" style="background:${pct >= 60 ? '#dcfce7' : '#fee2e2'};color:${pct >= 60 ? '#166534' : '#991b1b'};">${grade}</span></td>
                </tr>`;
            });
            html += `</tbody></table></div></div>`;
        });
        container.innerHTML = html;
    }

    // ============================================================
    // BEHAVIOR TAB
    // ============================================================
    function renderBehavior(student) {
        const beh = student.behavioral_observation || {};
        const ctx = document.getElementById("behavior-radar-chart");
        if (ctx) {
            if (radarChartInstance) radarChartInstance.destroy();
            const labels = Object.keys(beh).map(k => k.charAt(0).toUpperCase() + k.slice(1));
            const data = Object.values(beh);
            if (labels.length > 0) {
                radarChartInstance = new Chart(ctx, {
                    type: "radar",
                    data: {
                        labels,
                        datasets: [{
                            label: "Rating",
                            data,
                            fill: true,
                            backgroundColor: "rgba(16,185,129,0.15)",
                            borderColor: "rgba(16,185,129,1)",
                            pointBackgroundColor: "rgba(16,185,129,1)"
                        }]
                    },
                    options: {
                        scales: { r: { min: 0, max: 5, ticks: { stepSize: 1 } } },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        // Behavior ratings list
        const ratingList = document.getElementById("behavior-ratings-list");
        if (ratingList) {
            let html = "";
            Object.entries(beh).forEach(([key, val]) => {
                const pct = (val / 5) * 100;
                html += `<div class="beh-rating-row">
                    <span class="beh-label">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
                    <div class="beh-bar-bg"><div class="beh-bar-fill" style="width:${pct}%;"></div></div>
                    <span class="beh-score">${val}/5</span>
                </div>`;
            });
            ratingList.innerHTML = html;
        }
    }

    // ============================================================
    // ACTIVITIES TAB
    // ============================================================
    function renderActivities(student) {
        const activities = student.co_curricular_activities || [];
        const awards = student.awards || [];

        const actContainer = document.getElementById("activities-list");
        if (actContainer) {
            if (activities.length === 0) {
                actContainer.innerHTML = `<p style="color:var(--text-muted);">No co-curricular activities recorded.</p>`;
            } else {
                actContainer.innerHTML = activities.map(a =>
                    `<div class="activity-item">
                        <span class="activity-icon">🎯</span>
                        <div>
                            <strong>${a.name || a}</strong>
                            ${a.date ? `<span class="activity-date">${a.date}</span>` : ""}
                            ${a.description ? `<p class="activity-desc">${a.description}</p>` : ""}
                        </div>
                    </div>`
                ).join("");
            }
        }

        const awardsContainer = document.getElementById("awards-list");
        if (awardsContainer) {
            if (awards.length === 0) {
                awardsContainer.innerHTML = `<p style="color:var(--text-muted);">No awards recorded.</p>`;
            } else {
                awardsContainer.innerHTML = awards.map(a =>
                    `<div class="award-item">
                        <span class="award-icon">🏆</span>
                        <div>
                            <strong>${a.title || a}</strong>
                            ${a.date ? `<span class="activity-date">${a.date}</span>` : ""}
                            ${a.description ? `<p class="activity-desc">${a.description}</p>` : ""}
                        </div>
                    </div>`
                ).join("");
            }
        }
    }

    // ============================================================
    // MEETINGS TAB
    // ============================================================
    function renderMeetings(student) {
        const meetings = student.parent_meetings || [];
        const container = document.getElementById("meetings-list");
        if (!container) return;
        if (meetings.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);">No parent meetings recorded.</p>`;
        } else {
            container.innerHTML = meetings.map(m =>
                `<div class="meeting-item">
                    <div class="meeting-header">
                        <strong>${m.purpose || "Meeting"}</strong>
                        <span class="meeting-date">${m.date || ""}</span>
                    </div>
                    ${m.notes ? `<p class="meeting-notes">${m.notes}</p>` : ""}
                    ${m.outcome ? `<p class="meeting-outcome">Outcome: ${m.outcome}</p>` : ""}
                </div>`
            ).join("");
        }

        // Parent feedback & reply
        renderParentFeedback(student);
    }

    // ============================================================
    // PARENT FEEDBACK & PRINCIPAL REPLY
    // ============================================================
    function renderParentFeedback(student) {
        const feedbackEl = document.getElementById("parent-feedback-text");
        const replyEl = document.getElementById("principal-reply-text");
        if (feedbackEl) feedbackEl.value = student.parent_feedback || "";
        if (replyEl) replyEl.value = student.principal_reply || "";
    }

    document.getElementById("submit-feedback-btn")?.addEventListener("click", async function () {
        const text = document.getElementById("parent-feedback-text")?.value?.trim();
        const studentId = localStorage.getItem("sptas_student_id");
        if (!text || !studentId) return;

        const res = await fetch("/api/parent/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ student_id: studentId, feedback: text })
        });
        const data = await res.json();
        if (data.success) showToast("Feedback submitted.", "success");
    });

    document.getElementById("save-principal-reply-btn")?.addEventListener("click", async function () {
        const text = document.getElementById("principal-reply-text")?.value?.trim();
        const studentId = currentStudentId;
        if (!studentId) return;

        const res = await fetch("/api/principal/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ student_id: studentId, reply: text || "" })
        });
        const data = await res.json();
        if (data.success) showToast("Reply saved.", "success");
    });

    // ============================================================
    // ADD STUDENT BUTTON
    // ============================================================
    document.getElementById("admin-add-student-btn")?.addEventListener("click", openAddStudentModal);

    function openAddStudentModal() {
        openStudentModal(null);
    }

    window.editStudent = async function (studentId) {
        const res = await fetch(`/api/student/${studentId}`);
        const student = await res.json();
        openStudentModal(student);
    };

    function openStudentModal(student) {
        activeModalStudent = student;
        const modal = document.getElementById("student-modal");
        if (!modal) return;

        const isEdit = !!student;
        document.getElementById("modal-title").textContent = isEdit ? "Edit Student Record" : "Add New Student";

        // Basic info fields
        document.getElementById("form-student-name").value = student?.name || "";
        document.getElementById("form-roll-no").value = student?.roll_no || "";
        document.getElementById("form-admission-no").value = student?.admission_no || "";
        document.getElementById("form-class").value = student?.class || "10";
        document.getElementById("form-section").value = student?.section || "A";
        document.getElementById("form-dob").value = student?.dob || "";
        document.getElementById("form-academic-year").value = student?.academic_year || "2025-26";
        document.getElementById("form-parent-name").value = student?.parent_name || "";
        document.getElementById("form-parent-contact").value = student?.parent_contact || "";
        document.getElementById("form-parent-alt-contact").value = student?.parent_alt_contact || "";
        document.getElementById("form-class-teacher").value = student?.current_status?.class_teacher || "";
        document.getElementById("form-attendance-pct").value = student?.current_status?.attendance_percentage || 90;
        document.getElementById("form-performance-trend").value = student?.performance_trend || "Stable";
        document.getElementById("form-attendance-status").value = student?.attendance_status || "Present";

        // Behavior fields
        const beh = student?.behavioral_observation || { discipline: 4, leadership: 4, participation: 4, communication: 4, teamwork: 4, confidence: 4 };
        document.getElementById("form-beh-discipline").value = beh.discipline || 4;
        document.getElementById("form-beh-leadership").value = beh.leadership || 4;
        document.getElementById("form-beh-participation").value = beh.participation || 4;
        document.getElementById("form-beh-communication").value = beh.communication || 4;
        document.getElementById("form-beh-teamwork").value = beh.teamwork || 4;
        document.getElementById("form-beh-confidence").value = beh.confidence || 4;

        // Load exam section
        loadModalExamSection(student);

        modal.classList.remove("hidden");

        // Tab reset
        document.querySelectorAll(".modal-tab-btn").forEach((b, i) => b.classList.toggle("active", i === 0));
        document.querySelectorAll(".modal-tab-content").forEach((c, i) => c.classList.toggle("hidden", i !== 0));
        lucide.createIcons();
    }

    function loadModalExamSection(student) {
        const examContainer = document.getElementById("modal-exam-rows");
        if (!examContainer) return;
        const progress = student?.examination_progress || [];
        const latest = progress[progress.length - 1];
        if (!latest) return;

        document.getElementById("modal-exam-name").value = latest.exam_name || latest.exam || "";
        document.getElementById("modal-exam-year").value = latest.year || new Date().getFullYear();

        examContainer.innerHTML = "";
        (latest.subjects || []).forEach(sub => addExamRow(sub.name, sub.obtained, sub.max));
        updateExamTotals();
    }

    // Exam rows in modal
    document.getElementById("modal-add-subject-row")?.addEventListener("click", () => addExamRow());

    function addExamRow(subName = "", obtained = 0, max = 100) {
        const container = document.getElementById("modal-exam-rows");
        if (!container) return;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><input type="text" class="form-input exam-sub-name" value="${subName}" placeholder="Subject name" style="min-width:120px;"></td>
            <td><input type="number" class="form-input exam-obtained" value="${obtained}" min="0" max="200" style="width:80px;" oninput="updateExamTotals()"></td>
            <td><input type="number" class="form-input exam-max" value="${max}" min="0" max="200" style="width:80px;" oninput="updateExamTotals()"></td>
            <td><button type="button" class="btn-action btn-delete" onclick="this.closest('tr').remove();updateExamTotals();"><i data-lucide="trash-2"></i></button></td>`;
        container.appendChild(row);
        lucide.createIcons();
    }

    window.updateExamTotals = function () {
        let totalObt = 0, totalMax = 0;
        document.querySelectorAll("#modal-exam-rows tr").forEach(row => {
            totalObt += parseInt(row.querySelector(".exam-obtained")?.value || 0);
            totalMax += parseInt(row.querySelector(".exam-max")?.value || 0);
        });
        setEl("modal-exam-total-obtained", totalObt);
        setEl("modal-exam-total-max", totalMax);
        const pct = totalMax > 0 ? ((totalObt / totalMax) * 100).toFixed(1) : 0;
        setEl("modal-exam-percentage", `${pct}%`);
        setEl("modal-exam-passfail", totalMax > 0 && pct >= 33 ? "PASS" : "FAIL");
    };

    document.getElementById("modal-exam-save-btn")?.addEventListener("click", async function () {
        const student = activeModalStudent;
        if (!student) return;

        const examName = document.getElementById("modal-exam-name")?.value.trim();
        const examYear = document.getElementById("modal-exam-year")?.value.trim();
        const subjects = [];
        document.querySelectorAll("#modal-exam-rows tr").forEach(row => {
            const name = row.querySelector(".exam-sub-name")?.value.trim();
            const obtained = parseInt(row.querySelector(".exam-obtained")?.value || 0);
            const max = parseInt(row.querySelector(".exam-max")?.value || 100);
            if (name) subjects.push({ name, obtained, max });
        });

        const existing = student.examination_progress || [];
        const idx = existing.findIndex(e => (e.exam_name || e.exam) === examName);
        const examEntry = { exam_name: examName, exam: examName, year: examYear, subjects };
        if (idx >= 0) existing[idx] = examEntry;
        else existing.push(examEntry);

        const res = await fetch(`/api/admin/student/update/${student.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...student, examination_progress: existing })
        });
        const data = await res.json();
        if (data.success) showToast("Exam scorecard saved.", "success");
    });

    // Modal tabs
    document.querySelectorAll(".modal-tab-btn").forEach(btn => {
        btn.addEventListener("click", function () {
            const tabId = btn.getAttribute("data-modal-tab");
            document.querySelectorAll(".modal-tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".modal-tab-content").forEach(c => c.classList.add("hidden"));
            btn.classList.add("active");
            document.getElementById(tabId)?.classList.remove("hidden");
        });
    });

    // Cancel / close modal
    document.getElementById("cancel-student-modal-btn")?.addEventListener("click", closeStudentModal);
    document.querySelector("#student-modal .modal-close-btn")?.addEventListener("click", closeStudentModal);
    function closeStudentModal() {
        document.getElementById("student-modal")?.classList.add("hidden");
    }

    // Save student form
    document.getElementById("student-form")?.addEventListener("submit", async function (e) {
        e.preventDefault();

        const parentContact = document.getElementById("form-parent-contact").value.trim();
        const cleanedContact = cleanPhone(parentContact);
        if (cleanedContact.length > 10) {
            showToast("Parent contact must be 10 digits or less.", "error");
            return;
        }

        const altContact = document.getElementById("form-parent-alt-contact").value.trim();
        if (altContact) {
            const cleanedAlt = cleanPhone(altContact);
            if (cleanedAlt.length > 10) {
                showToast("Alternate contact must be 10 digits or less.", "error");
                return;
            }
        }

        const body = {
            name: document.getElementById("form-student-name").value.trim(),
            roll_no: document.getElementById("form-roll-no").value.trim(),
            admission_no: document.getElementById("form-admission-no").value.trim(),
            class: document.getElementById("form-class").value,
            section: document.getElementById("form-section").value,
            dob: document.getElementById("form-dob").value,
            academic_year: document.getElementById("form-academic-year").value,
            parent_name: document.getElementById("form-parent-name").value.trim(),
            parent_contact: cleanedContact,
            parent_alt_contact: altContact ? cleanPhone(altContact) : "",
            class_teacher: document.getElementById("form-class-teacher").value.trim(),
            attendance_percentage: parseFloat(document.getElementById("form-attendance-pct").value),
            performance_trend: document.getElementById("form-performance-trend").value,
            attendance_status: document.getElementById("form-attendance-status").value,
            behavioral_observation: {
                discipline: parseInt(document.getElementById("form-beh-discipline").value),
                leadership: parseInt(document.getElementById("form-beh-leadership").value),
                participation: parseInt(document.getElementById("form-beh-participation").value),
                communication: parseInt(document.getElementById("form-beh-communication").value),
                teamwork: parseInt(document.getElementById("form-beh-teamwork").value),
                confidence: parseInt(document.getElementById("form-beh-confidence").value)
            }
        };

        // Preserve existing data if editing
        if (activeModalStudent) {
            body.examination_progress = activeModalStudent.examination_progress || [];
            body.subject_performance = activeModalStudent.subject_performance || [];
            body.co_curricular_activities = activeModalStudent.co_curricular_activities || [];
            body.awards = activeModalStudent.awards || [];
            body.parent_meetings = activeModalStudent.parent_meetings || [];
            body.teacher_term_remarks = activeModalStudent.teacher_term_remarks || [];
        }

        const isEdit = !!activeModalStudent;
        const url = isEdit ? `/api/admin/student/update/${activeModalStudent.id}` : "/api/admin/student/create";

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (data.success) {
            closeStudentModal();
            showToast(isEdit ? "Student updated." : "Student created.", "success");
            loadStudentTable();
        } else {
            showToast(data.message || "Error saving.", "error");
        }
    });

    // Back button from report to admin dashboard
    document.getElementById("back-to-search-btn")?.addEventListener("click", function () {
        if (liveTickerInterval) clearInterval(liveTickerInterval);
        const role = localStorage.getItem("sptas_role");
        if (role === "parent") return;
        dashboardReportPage.classList.add("hidden");
        adminDashboardView.classList.remove("hidden");
        loadStudentTable();
    });

    // Print button
    document.getElementById("print-pdf-btn")?.addEventListener("click", () => window.print());

    // Parent settings button
    document.getElementById("parent-settings-btn")?.addEventListener("click", function () {
        const studentId = localStorage.getItem("sptas_student_id");
        if (!studentId) return;
        showPasswordSetupModal("parent", studentId, "Parent");
    });

    // Tab navigation in report card
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", function () {
            const tabId = btn.getAttribute("data-tab");
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(tabId)?.classList.add("active");
        });
    });

    // ============================================================
    // TIMETABLE TAB in STUDENT MODAL
    // ============================================================
    let modalTimetableData = {};

    document.getElementById("modal-timetable-day-select")?.addEventListener("change", function () {
        saveModalTimetableDay();
        renderModalTimetableDay(this.value);
    });

    function saveModalTimetableDay() {
        const daySelect = document.getElementById("modal-timetable-day-select");
        if (!daySelect) return;
        const day = daySelect.value;
        const rows = document.querySelectorAll("#modal-timetable-rows tr");
        const periods = [];
        rows.forEach(row => {
            periods.push({
                period: row.querySelector(".mt-period")?.value || "",
                time: row.querySelector(".mt-time")?.value || "",
                subject: row.querySelector(".mt-subject")?.value || "",
                teacher: row.querySelector(".mt-teacher")?.value || "",
                room: row.querySelector(".mt-room")?.value || "",
                status: row.querySelector(".mt-status")?.value || "Class In Progress"
            });
        });
        modalTimetableData[day] = periods;
    }

    function renderModalTimetableDay(day) {
        const periods = modalTimetableData[day] || activeModalStudent?.timetable?.[day] || [];
        const tbody = document.getElementById("modal-timetable-rows");
        if (!tbody) return;
        tbody.innerHTML = "";
        periods.forEach(p => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><input type="text" class="form-input mt-period" value="${p.period}" style="width:55px;"></td>
                <td><input type="text" class="form-input mt-time" value="${p.time}" style="width:190px;"></td>
                <td><input type="text" class="form-input mt-subject" value="${p.subject}"></td>
                <td><input type="text" class="form-input mt-teacher" value="${p.teacher}"></td>
                <td><input type="text" class="form-input mt-room" value="${p.room}"></td>
                <td>
                    <select class="form-select mt-status" style="width:130px;">
                        <option ${p.status === "Class In Progress" ? "selected" : ""}>Class In Progress</option>
                        <option ${p.status === "Recess" ? "selected" : ""}>Recess</option>
                        <option ${p.status === "Break" ? "selected" : ""}>Break</option>
                        <option ${p.status === "Free Period" ? "selected" : ""}>Free Period</option>
                    </select>
                </td>
                <td><button type="button" class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>`;
            tbody.appendChild(row);
        });
        lucide.createIcons();
    }

    document.getElementById("modal-add-period-row")?.addEventListener("click", function () {
        const tbody = document.getElementById("modal-timetable-rows");
        if (!tbody) return;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><input type="text" class="form-input mt-period" value="" style="width:55px;"></td>
            <td><input type="text" class="form-input mt-time" value="" style="width:190px;"></td>
            <td><input type="text" class="form-input mt-subject" value=""></td>
            <td><input type="text" class="form-input mt-teacher" value=""></td>
            <td><input type="text" class="form-input mt-room" value=""></td>
            <td>
                <select class="form-select mt-status" style="width:130px;">
                    <option>Class In Progress</option><option>Recess</option>
                    <option>Break</option><option>Free Period</option>
                </select>
            </td>
            <td><button type="button" class="btn-action btn-delete" onclick="this.closest('tr').remove()"><i data-lucide="trash-2"></i></button></td>`;
        tbody.appendChild(row);
        lucide.createIcons();
    });

    // ============================================================
    // TOAST NOTIFICATION
    // ============================================================
    function showToast(msg, type = "success") {
        const existing = document.getElementById("sptas-toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.id = "sptas-toast";
        toast.className = `sptas-toast toast-${type}`;
        toast.innerHTML = `<i data-lucide="${type === "success" ? "check-circle" : "alert-circle"}"></i> ${msg}`;
        document.body.appendChild(toast);
        lucide.createIcons();

        setTimeout(() => toast.classList.add("toast-visible"), 50);
        setTimeout(() => {
            toast.classList.remove("toast-visible");
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    }

    window.showToast = showToast;
    window.updateExamTotals = window.updateExamTotals;
});
