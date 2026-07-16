import os
import json
import random
import string
import io
from flask import Flask, render_template, jsonify, request, send_file
from datetime import datetime
try:
    import openpyxl
    from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'sptas-school-secret-2026')

DB_DIR = os.path.dirname(__file__)

# In-memory OTP store {phone: otp_code}
OTP_STORE = {}

# =========================================================
# DATABASE HELPERS
# =========================================================
def load_json(filename, default=None):
    path = os.path.join(DB_DIR, filename)
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return default if default is not None else []

def save_json(filename, data):
    path = os.path.join(DB_DIR, filename)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except:
        return False

def load_db():       return load_json('students_db.json', [])
def save_db(d):      return save_json('students_db.json', d)
def load_teachers(): return load_json('teachers_db.json', [])
def save_teachers(d): return save_json('teachers_db.json', d)
def load_timetables(): return load_json('timetables_db.json', {})
def save_timetables(d): return save_json('timetables_db.json', d)
def load_settings(): return load_json('settings.json', {})
def save_settings(d): return save_json('settings.json', d)
def load_meetings(): return load_json('meetings_db.json', [])
def save_meetings(d): return save_json('meetings_db.json', d)

def clean_phone(phone):
    if not phone: return ""
    return str(phone).replace(" ","").replace("-","").replace("+91","").strip()

# =========================================================
# ROUTES
# =========================================================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/stats', methods=['GET'])
def get_stats():
    students = load_db()
    teachers = load_teachers()
    total = len(students)
    classes = len(set(f"{s['class']}-{s['section']}" for s in students)) if students else 0
    avg_att = f"{sum(s['current_status']['attendance_percentage'] for s in students)/total:.1f}%" if total else "0%"
    return jsonify({"total_students": total, "active_classes": classes,
                    "overall_attendance": avg_att, "teachers": len(teachers)})

# =========================================================
# SETTINGS
# =========================================================
@app.route('/api/settings', methods=['GET'])
def get_settings():
    s = load_settings()
    return jsonify({"success": True, "principal_name": s.get("principal_name","Principal"),
                    "school_name": s.get("school_name","Silverwood International School")})

@app.route('/api/settings/update', methods=['POST'])
def update_settings():
    data = request.get_json() or {}
    s = load_settings()
    if "principal_name" in data: s["principal_name"] = data["principal_name"].strip()
    if "school_name" in data: s["school_name"] = data["school_name"].strip()
    return jsonify({"success": True}) if save_settings(s) else jsonify({"success": False}), 500

# =========================================================
# AUTHENTICATION
# =========================================================
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    role = data.get("role","")

    if role == "principal":
        s = load_settings()
        if (data.get("username") == s.get("principal_username","principal") and
                data.get("password") == s.get("principal_password","principal123")):
            return jsonify({"success": True, "role": "principal",
                            "name": s.get("principal_name","Dr. Principal")})
        return jsonify({"success": False, "message": "Invalid credentials."})

    elif role == "teacher":
        phone = clean_phone(data.get("phone",""))
        pwd = data.get("password","").strip()
        for t in load_teachers():
            if clean_phone(t.get("phone","")) == phone:
                if not t.get("password",""):
                    return jsonify({"success": True, "role": "teacher",
                                    "teacher_id": t["id"], "name": t["name"],
                                    "require_password_setup": True})
                if t["password"] == pwd:
                    return jsonify({"success": True, "role": "teacher",
                                    "teacher_id": t["id"], "name": t["name"],
                                    "require_password_setup": False})
                return jsonify({"success": False, "message": "Incorrect password."})
        return jsonify({"success": False, "message": "Phone number not registered."})

    elif role == "parent":
        roll = data.get("roll_no","").strip()
        phone = data.get("phone_no","").strip()
        pwd = data.get("password","").strip()
        for s in load_db():
            if s["roll_no"] == roll or s["id"] == roll:
                if (clean_phone(s.get("parent_contact","")) == clean_phone(phone) or
                        clean_phone(s.get("parent_alt_contact","")) == clean_phone(phone)):
                    saved = s.get("parent_password","")
                    if saved and saved != pwd:
                        return jsonify({"success": False, "message": "Incorrect password."})
                    return jsonify({"success": True, "role": "parent", "student_id": s["id"],
                                    "name": s["parent_name"],
                                    "require_password_setup": not bool(saved)})
        return jsonify({"success": False, "message": "Roll number and phone do not match."})

    return jsonify({"success": False, "message": "Invalid role."})

# =========================================================
# OTP — Forgot Password
# =========================================================
@app.route('/api/otp/send', methods=['POST'])
def send_otp():
    data = request.get_json() or {}
    phone = clean_phone(data.get("phone",""))
    role = data.get("role","")
    if not phone:
        return jsonify({"success": False, "message": "Phone number required."}), 400

    # Check phone exists
    found = False
    if role == "teacher":
        found = any(clean_phone(t.get("phone","")) == phone for t in load_teachers())
    elif role == "parent":
        for s in load_db():
            if (clean_phone(s.get("parent_contact","")) == phone or
                    clean_phone(s.get("parent_alt_contact","")) == phone):
                found = True; break
    elif role == "principal":
        found = True  # Principal always can reset

    if not found:
        return jsonify({"success": False, "message": "Phone number not found in records."}), 404

    otp = ''.join(random.choices(string.digits, k=4))
    OTP_STORE[phone] = otp
    # In production, send SMS. For demo, return OTP in response.
    return jsonify({"success": True, "otp_demo": otp,
                    "message": f"OTP sent to {phone[-4:].rjust(10,'*')}"})

@app.route('/api/otp/verify', methods=['POST'])
def verify_otp():
    data = request.get_json() or {}
    phone = clean_phone(data.get("phone",""))
    otp = data.get("otp","").strip()
    if OTP_STORE.get(phone) == otp:
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Invalid or expired OTP."}), 400

@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json() or {}
    phone = clean_phone(data.get("phone",""))
    new_pwd = data.get("password","").strip()
    role = data.get("role","")
    if not new_pwd:
        return jsonify({"success": False, "message": "Password cannot be empty."}), 400

    if role == "teacher":
        teachers = load_teachers()
        for t in teachers:
            if clean_phone(t.get("phone","")) == phone:
                t["password"] = new_pwd
                save_teachers(teachers)
                OTP_STORE.pop(phone, None)
                return jsonify({"success": True})
    elif role == "parent":
        students = load_db()
        for s in students:
            if (clean_phone(s.get("parent_contact","")) == phone or
                    clean_phone(s.get("parent_alt_contact","")) == phone):
                s["parent_password"] = new_pwd
                save_db(students)
                OTP_STORE.pop(phone, None)
                return jsonify({"success": True})
    elif role == "principal":
        settings = load_settings()
        settings["principal_password"] = new_pwd
        save_settings(settings)
        OTP_STORE.pop(phone, None)
        return jsonify({"success": True})

    return jsonify({"success": False, "message": "Reset failed."}), 400

# =========================================================
# PASSWORD SETUP
# =========================================================
@app.route('/api/teacher/set-password', methods=['POST'])
def teacher_set_password():
    data = request.get_json() or {}
    tid = data.get("teacher_id","")
    pwd = data.get("password","").strip()
    teachers = load_teachers()
    for t in teachers:
        if t["id"] == tid:
            t["password"] = pwd
            save_teachers(teachers)
            return jsonify({"success": True})
    return jsonify({"success": False}), 404

@app.route('/api/parent/set-password', methods=['POST'])
def parent_set_password():
    data = request.get_json() or {}
    sid = data.get("student_id","")
    pwd = data.get("password","").strip()
    students = load_db()
    for s in students:
        if s["id"] == sid:
            s["parent_password"] = pwd
            save_db(students)
            return jsonify({"success": True})
    return jsonify({"success": False}), 404

@app.route('/api/parent/feedback', methods=['POST'])
def parent_feedback():
    data = request.get_json() or {}
    sid = data.get("student_id","")
    fb = data.get("feedback","").strip()
    students = load_db()
    for s in students:
        if s["id"] == sid:
            s["parent_feedback"] = fb
            save_db(students)
            return jsonify({"success": True})
    return jsonify({"success": False}), 404

@app.route('/api/principal/reply', methods=['POST'])
def principal_reply():
    data = request.get_json() or {}
    sid = data.get("student_id","")
    reply = data.get("reply","").strip()
    students = load_db()
    for s in students:
        if s["id"] == sid:
            s["principal_reply"] = reply
            save_db(students)
            return jsonify({"success": True})
    return jsonify({"success": False}), 404

# =========================================================
# TEACHERS CRUD
# =========================================================
@app.route('/api/teachers', methods=['GET'])
def get_teachers():
    teachers = load_teachers()
    return jsonify([{
        "id": t["id"], "name": t["name"], "phone": t["phone"],
        "subjects": t.get("subjects",[]), "classes": t.get("classes",[]),
        "attendance_status": t.get("attendance_status","Present"),
        "email": t.get("email",""), "has_password": bool(t.get("password",""))
    } for t in teachers])

@app.route('/api/teacher/create', methods=['POST'])
def create_teacher():
    import time
    data = request.get_json() or {}
    phone = clean_phone(data.get("phone",""))
    name = data.get("name","").strip()
    if not phone or not name:
        return jsonify({"success": False, "message": "Name and Phone required."}), 400
    if any(clean_phone(t.get("phone","")) == phone for t in load_teachers()):
        return jsonify({"success": False, "message": "Teacher with this phone already exists."}), 400
    teachers = load_teachers()
    new_t = {
        "id": f"t{int(time.time())}",
        "name": name, "phone": phone, "password": "",
        "subjects": data.get("subjects",[]),
        "classes": data.get("classes",[]),  # list of "Class-Section" strings
        "attendance_status": "Present",
        "email": data.get("email","")
    }
    teachers.append(new_t)
    return jsonify({"success": True, "teacher_id": new_t["id"]}) if save_teachers(teachers) else jsonify({"success": False}), 500

@app.route('/api/teacher/update/<tid>', methods=['POST'])
def update_teacher(tid):
    data = request.get_json() or {}
    teachers = load_teachers()
    for t in teachers:
        if t["id"] == tid:
            if data.get("name"): t["name"] = data["name"].strip()
            if data.get("phone"): t["phone"] = clean_phone(data["phone"])
            if "subjects" in data: t["subjects"] = data["subjects"]
            if "classes" in data: t["classes"] = data["classes"]
            if "email" in data: t["email"] = data["email"]
            if "attendance_status" in data: t["attendance_status"] = data["attendance_status"]
            return jsonify({"success": True}) if save_teachers(teachers) else jsonify({"success": False}), 500
    return jsonify({"success": False}), 404

@app.route('/api/teacher/delete/<tid>', methods=['POST', 'DELETE'])
def delete_teacher(tid):
    teachers = load_teachers()
    new_list = [t for t in teachers if t["id"] != tid]
    if len(new_list) == len(teachers): return jsonify({"success": False}), 404
    return jsonify({"success": True}) if save_teachers(new_list) else jsonify({"success": False}), 500

@app.route('/api/teacher/attendance', methods=['POST'])
def update_teacher_attendance():
    data = request.get_json() or {}
    teachers = load_teachers()
    for t in teachers:
        if t["id"] == data.get("teacher_id",""):
            t["attendance_status"] = data.get("status","Present")
            return jsonify({"success": True}) if save_teachers(teachers) else jsonify({"success": False}), 500
    return jsonify({"success": False}), 404

# =========================================================
# TIMETABLE
# =========================================================
@app.route('/api/timetable/<class_key>', methods=['GET'])
def get_timetable(class_key):
    timetables = load_timetables()
    return jsonify({"success": True, "timetable": timetables.get(class_key)})

@app.route('/api/timetable/save', methods=['POST'])
def save_timetable():
    data = request.get_json() or {}
    class_key = data.get("class_key","")
    timetable = data.get("timetable",{})
    if not class_key: return jsonify({"success": False}), 400
    timetables = load_timetables()
    timetables[class_key] = timetable
    if save_timetables(timetables):
        # Propagate to students in this class-section
        parts = class_key.split("-",1)
        if len(parts) == 2:
            students = load_db()
            for s in students:
                if str(s["class"]) == parts[0] and s["section"] == parts[1]:
                    s["timetable"] = timetable
            save_db(students)
        return jsonify({"success": True})
    return jsonify({"success": False}), 500

# =========================================================
# ATTENDANCE
# =========================================================
@app.route('/api/attendance/save', methods=['POST'])
def save_attendance():
    data = request.get_json() or {}
    date = data.get("date","")
    records = data.get("records",[])
    students = load_db()
    for rec in records:
        for s in students:
            if s["id"] == rec["student_id"]:
                if "attendance_records" not in s: s["attendance_records"] = []
                existing = next((r for r in s["attendance_records"] if r["date"]==date), None)
                if existing: existing["status"] = rec["status"]
                else: s["attendance_records"].append({"date": date, "status": rec["status"]})
                s["attendance_status"] = "Absent" if rec["status"]=="Absent" else "Present"
    return jsonify({"success": True, "updated": len(records)}) if save_db(students) else jsonify({"success": False}), 500

@app.route('/api/attendance/class', methods=['GET'])
def get_class_attendance():
    cls = request.args.get('class','')
    sec = request.args.get('section','')
    date = request.args.get('date','')
    students = load_db()
    result = []
    for s in students:
        if cls and str(s["class"]) != cls: continue
        if sec and s["section"] != sec: continue
        status = "Present"
        if date:
            rec = next((r for r in s.get("attendance_records",[]) if r["date"]==date), None)
            if rec: status = rec["status"]
        result.append({"id": s["id"], "name": s["name"], "roll_no": s["roll_no"],
                        "attendance_status": status})
    return jsonify(sorted(result, key=lambda x: x["roll_no"]))

@app.route('/api/attendance/report', methods=['GET'])
def attendance_report():
    cls = request.args.get('class','')
    sec = request.args.get('section','')
    month = request.args.get('month','')
    students = load_db()
    report = []
    for s in students:
        if cls and str(s["class"]) != cls: continue
        if sec and s["section"] != sec: continue
        recs = [r for r in s.get("attendance_records",[]) if (not month or r["date"].startswith(month))]
        present = sum(1 for r in recs if r["status"] in ["Present","Half Day"])
        absent = sum(1 for r in recs if r["status"]=="Absent")
        half = sum(1 for r in recs if r["status"]=="Half Day")
        total = len(recs)
        report.append({"id": s["id"], "name": s["name"], "roll_no": s["roll_no"],
                        "class": s["class"], "section": s["section"],
                        "present_days": present, "absent_days": absent, "half_days": half,
                        "total_days": total,
                        "percentage": round(present/total*100,1) if total else 0})
    return jsonify(report)

# =========================================================
# PARENT MEETINGS (Principal manages)
# =========================================================
@app.route('/api/meetings', methods=['GET'])
def get_meetings():
    return jsonify(load_meetings())

@app.route('/api/meetings/save', methods=['POST'])
def save_meeting():
    import time
    data = request.get_json() or {}
    meetings = load_meetings()
    meeting_id = data.get("id","")
    if meeting_id:
        for m in meetings:
            if m["id"] == meeting_id:
                m.update({k: data[k] for k in ["title","date","time","venue","classes","notes"] if k in data})
                return jsonify({"success": True}) if save_meetings(meetings) else jsonify({"success": False}), 500
    else:
        new_m = {
            "id": f"mtg{int(time.time())}",
            "title": data.get("title","Parent Meeting"),
            "date": data.get("date",""),
            "time": data.get("time",""),
            "venue": data.get("venue",""),
            "classes": data.get("classes","all"),  # "all" or list of class-section strings
            "notes": data.get("notes","")
        }
        meetings.append(new_m)
        return jsonify({"success": True, "id": new_m["id"]}) if save_meetings(meetings) else jsonify({"success": False}), 500

@app.route('/api/meetings/delete/<mid>', methods=['POST','DELETE'])
def delete_meeting(mid):
    meetings = load_meetings()
    new_list = [m for m in meetings if m["id"] != mid]
    return jsonify({"success": True}) if save_meetings(new_list) else jsonify({"success": False}), 500

# =========================================================
# STUDENT CRUD
# =========================================================
@app.route('/api/admin/student/create', methods=['POST'])
def admin_create_student():
    import time
    data = request.get_json() or {}
    parent_contact = clean_phone(data.get("parent_contact",""))
    if not parent_contact:
        return jsonify({"success": False, "message": "Parent contact is required!"}), 400
    name = data.get("name","").strip()
    roll_no = data.get("roll_no","").strip()
    if not name or not roll_no:
        return jsonify({"success": False, "message": "Name and Roll Number required!"}), 400

    students = load_db()
    s_class = str(data.get("class","10"))
    s_section = data.get("section","A")
    if any(s["class"]==s_class and s["section"]==s_section and s["roll_no"]==roll_no for s in students):
        return jsonify({"success": False, "message": f"Roll {roll_no} already in {s_class}-{s_section}"}), 400

    class_key = f"{s_class}-{s_section}"
    timetables = load_timetables()
    class_timetable = timetables.get(class_key, {})

    student_id = str(int(time.time()))
    new_student = {
        "id": student_id,
        "name": name, "roll_no": roll_no,
        "admission_no": data.get("admission_no",""),
        "class": s_class, "section": s_section,
        "academic_year": data.get("academic_year","2025-26"),
        "dob": data.get("dob",""),
        "parent_name": data.get("parent_name",""),
        "parent_contact": parent_contact,
        "parent_alt_contact": clean_phone(data.get("parent_alt_contact","")),
        "parent_password": "", "parent_feedback": "", "principal_reply": "",
        "attendance_status": data.get("attendance_status","Present"),
        "attendance_records": [],
        "current_status": {
            "standard": f"Class {s_class}", "section": f"Section {s_section}",
            "class_teacher": data.get("class_teacher","Class Teacher"),
            "attendance_percentage": float(data.get("attendance_percentage",90)),
            "subjects": data.get("subjects",["Mathematics","Science","English","Hindi","Social Studies"])
        },
        "timetable": class_timetable,
        "examination_progress": data.get("examination_progress",[]),
        "subject_performance": data.get("subject_performance",[]),
        "progress_comparison": data.get("progress_comparison",[]),
        "performance_trend": data.get("performance_trend","Stable"),
        "teacher_term_remarks": data.get("teacher_term_remarks",[]),
        "behavioral_observation": data.get("behavioral_observation",
            {"discipline":4,"leadership":4,"participation":4,"communication":4,"teamwork":4,"confidence":4}),
        "co_curricular_activities": data.get("co_curricular_activities",[]),
        "awards": data.get("awards",[]),
        "parent_meetings": data.get("parent_meetings",[])
    }
    students.append(new_student)
    return jsonify({"success": True, "student_id": student_id}) if save_db(students) else jsonify({"success": False}), 500

@app.route('/api/admin/student/update/<student_id>', methods=['POST'])
def admin_update_student(student_id):
    data = request.get_json() or {}
    students = load_db()
    for s in students:
        if s["id"] == student_id:
            old_pwd = s.get("parent_password","")
            old_fb = s.get("parent_feedback","")
            old_reply = s.get("principal_reply","")

            for field in ["name","roll_no","admission_no","dob","academic_year","parent_name","performance_trend","attendance_status"]:
                if field in data: s[field] = data[field]
            s["class"] = str(data.get("class", s["class"]))
            s["section"] = data.get("section", s["section"])

            pc = clean_phone(data.get("parent_contact",""))
            if not pc: return jsonify({"success": False, "message": "Parent contact required!"}), 400
            s["parent_contact"] = pc
            s["parent_alt_contact"] = clean_phone(data.get("parent_alt_contact",""))

            if "current_status" not in s: s["current_status"] = {}
            s["current_status"]["standard"] = f"Class {s['class']}"
            s["current_status"]["section"] = f"Section {s['section']}"
            if "class_teacher" in data: s["current_status"]["class_teacher"] = data["class_teacher"]
            if "attendance_percentage" in data: s["current_status"]["attendance_percentage"] = float(data["attendance_percentage"])
            if "subjects" in data: s["current_status"]["subjects"] = data["subjects"]

            for field in ["timetable","examination_progress","subject_performance","progress_comparison",
                          "teacher_term_remarks","behavioral_observation","co_curricular_activities","awards","parent_meetings"]:
                if field in data: s[field] = data[field]

            s["parent_password"] = old_pwd
            s["parent_feedback"] = old_fb
            s["principal_reply"] = data.get("principal_reply", old_reply)

            return jsonify({"success": True}) if save_db(students) else jsonify({"success": False}), 500
    return jsonify({"success": False, "message": "Not found"}), 404

@app.route('/api/admin/student/delete/<student_id>', methods=['POST','DELETE'])
def admin_delete_student(student_id):
    students = load_db()
    new_s = [s for s in students if s["id"] != student_id]
    if len(new_s) == len(students): return jsonify({"success": False}), 404
    return jsonify({"success": True}) if save_db(new_s) else jsonify({"success": False}), 500

@app.route('/api/search', methods=['GET'])
def search_students():
    q = request.args.get('q','').lower()
    cls = request.args.get('class','')
    sec = request.args.get('section','')
    students = load_db()
    def summary(s):
        return {"id": s["id"], "name": s["name"], "admission_no": s.get("admission_no",""),
                "roll_no": s["roll_no"], "class": s["class"], "section": s["section"],
                "parent_name": s.get("parent_name",""), "parent_contact": s.get("parent_contact",""),
                "attendance": s["current_status"]["attendance_percentage"],
                "trend": s.get("performance_trend","Stable"),
                "parent_feedback": s.get("parent_feedback",""),
                "principal_reply": s.get("principal_reply",""),
                "attendance_status": s.get("attendance_status","Present")}
    results = []
    for s in students:
        if cls and str(s["class"]) != cls: continue
        if sec and s["section"] != sec: continue
        if q and not any([q in s["name"].lower(), q in s.get("admission_no","").lower(),
                          q == s["roll_no"], q in s.get("parent_contact",""),
                          q in s.get("parent_alt_contact","")]): continue
        results.append(summary(s))
    return jsonify(results)

@app.route('/api/student/<student_id>', methods=['GET'])
def get_student(student_id):
    for s in load_db():
        if s["id"] == student_id: return jsonify(s)
    return jsonify({"error": "Not found"}), 404

# =========================================================
# EXCEL HELPERS
# =========================================================
DEFAULT_SUBJECTS = ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies', 'Computer Science']
CLASS_LIST = ['0', 'Nursery', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
EXAM_LIST  = ['Unit Test 1', 'Unit Test 2', 'Half Yearly', 'Pre-Annual', 'Annual']

def get_grade(pct):
    if pct >= 90: return 'A+'
    if pct >= 80: return 'A'
    if pct >= 70: return 'B+'
    if pct >= 60: return 'B'
    if pct >= 50: return 'C'
    if pct >= 33: return 'D'
    return 'F'

def style_header(ws, row, cols, fill_hex='1E3A5F', font_size=11):
    fill = PatternFill(start_color=fill_hex, end_color=fill_hex, fill_type='solid')
    font = Font(bold=True, color='FFFFFF', size=font_size)
    align = Alignment(horizontal='center', vertical='center', wrap_text=True)
    thin = Side(style='thin', color='999999')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = fill; cell.font = font
        cell.alignment = align; cell.border = border

def style_data_row(ws, row, cols, even=False):
    fill = PatternFill(start_color='F0F4FF' if even else 'FFFFFF',
                       end_color='F0F4FF' if even else 'FFFFFF', fill_type='solid')
    thin = Side(style='thin', color='DDDDDD')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    align = Alignment(horizontal='center', vertical='center')
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = fill; cell.border = border; cell.alignment = align

# =========================================================
# DOWNLOAD SAMPLE EXCEL
# =========================================================
@app.route('/api/excel/sample-marks', methods=['GET'])
def download_sample_marks():
    if not OPENPYXL_AVAILABLE:
        return jsonify({'error': 'openpyxl not installed'}), 500

    cls = request.args.get('class', '10')
    sec = request.args.get('section', 'A')
    subjects = request.args.get('subjects', ','.join(DEFAULT_SUBJECTS)).split(',')
    subjects = [s.strip() for s in subjects if s.strip()]
    max_marks_each = int(request.args.get('max_marks', 100))

    students = load_db()
    class_students = sorted(
        [s for s in students if str(s['class']) == cls and s['section'] == sec],
        key=lambda x: x['roll_no']
    )

    wb = openpyxl.Workbook()

    # ---- INSTRUCTIONS SHEET ----
    info = wb.active; info.title = 'Instructions'
    info.column_dimensions['A'].width = 90
    info.row_dimensions[1].height = 30
    info['A1'] = 'SPTAS — Marks Import Template'
    info['A1'].font = Font(bold=True, size=16, color='1E3A5F')
    info['A2'] = f'School Class: {cls} | Section: {sec} | Max Marks per subject: {max_marks_each}'
    info['A2'].font = Font(size=12, italic=True, color='555555')
    info['A4'] = 'INSTRUCTIONS:'
    info['A4'].font = Font(bold=True, size=12)
    instructions = [
        '1. Each sheet below represents ONE exam (e.g. Unit Test 1, Half Yearly, Annual).',
        '2. Fill in marks (numbers only) in the coloured subject columns.',
        '3. DO NOT change Roll No, Student Name, Class, or Section columns.',
        '4. DO NOT rename, delete, or reorder sheets.',
        '5. Total, Percentage, Grade, and Rank columns will be auto-calculated on upload.',
        '6. Leave marks as 0 if student was absent. Add a note in the Remarks column.',
        '7. After filling all exams, save the file and upload it in the portal.',
        f'8. Max marks per subject = {max_marks_each}. Total max = {max_marks_each * len(subjects)}.',
    ]
    for i, line in enumerate(instructions):
        info[f'A{5+i}'] = line
        info[f'A{5+i}'].font = Font(size=11)

    # ---- EXAM SHEETS ----
    subj_fill = PatternFill(start_color='FFF3CD', end_color='FFF3CD', fill_type='solid')
    lock_fill = PatternFill(start_color='E8F4F8', end_color='E8F4F8', fill_type='solid')
    calc_fill  = PatternFill(start_color='D4EDDA', end_color='D4EDDA', fill_type='solid')

    for exam in EXAM_LIST:
        ws = wb.create_sheet(title=exam.replace(' ', '_'))
        ws.freeze_panes = 'E3'

        # Title row
        total_cols = 4 + len(subjects) + 4  # roll,name,class,sec + subjects + total,pct,grade,rank + remarks
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols)
        title_cell = ws.cell(row=1, column=1)
        title_cell.value = f'SPTAS — {exam} Marks | Class {cls}-{sec} | Max/Subject: {max_marks_each}'
        title_cell.font = Font(bold=True, size=13, color='FFFFFF')
        title_cell.fill = PatternFill(start_color='1E1B4B', end_color='1E1B4B', fill_type='solid')
        title_cell.alignment = Alignment(horizontal='center', vertical='center')
        ws.row_dimensions[1].height = 28

        # Header row
        headers = ['Roll No', 'Student Name', 'Class', 'Section'] + subjects + \
                  ['Total', 'Percentage', 'Grade', 'Class Rank', 'Remarks']
        for col, h in enumerate(headers, 1):
            ws.cell(row=2, column=col).value = h
        style_header(ws, 2, len(headers))

        # Colour subject columns
        for col in range(5, 5 + len(subjects)):
            ws.cell(row=2, column=col).fill = PatternFill(start_color='1D6A3A', end_color='1D6A3A', fill_type='solid')
            ws.cell(row=2, column=col).font = Font(bold=True, color='FFFFFF', size=11)

        # Colour calculated columns
        calc_start = 5 + len(subjects)
        for col in range(calc_start, calc_start + 4):
            ws.cell(row=2, column=col).fill = PatternFill(start_color='0C4A6E', end_color='0C4A6E', fill_type='solid')
            ws.cell(row=2, column=col).font = Font(bold=True, color='FFFFFF', size=11)

        # Student rows
        for row_i, student in enumerate(class_students, start=3):
            even = (row_i % 2 == 0)
            row_data = [
                student['roll_no'], student['name'],
                student['class'], student['section']
            ] + [0] * len(subjects) + ['', '', '', '', '']
            for col, val in enumerate(row_data, 1):
                cell = ws.cell(row=row_i, column=col, value=val)
                # Lock columns style
                if col <= 4:
                    cell.fill = lock_fill
                    cell.font = Font(size=10, bold=(col==1))
                elif col <= 4 + len(subjects):
                    cell.fill = subj_fill
                    cell.font = Font(size=11)
                else:
                    cell.fill = calc_fill
                    cell.font = Font(size=10, color='555555')
                cell.alignment = Alignment(horizontal='center', vertical='center')
                thin = Side(style='thin', color='CCCCCC')
                cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)

        # If no students, add example rows
        if not class_students:
            for ex_i, ex_name in enumerate(['Example Student 1', 'Example Student 2'], start=3):
                row_data = [ex_i - 2, ex_name, cls, sec] + [0]*len(subjects) + ['','','','',' ']
                for col, val in enumerate(row_data, 1):
                    ws.cell(row=ex_i, column=col, value=val)

        # Column widths
        ws.column_dimensions['A'].width = 10
        ws.column_dimensions['B'].width = 24
        ws.column_dimensions['C'].width = 8
        ws.column_dimensions['D'].width = 10
        for c in range(5, 5 + len(subjects)):
            ws.column_dimensions[get_column_letter(c)].width = 14
        for c in range(5+len(subjects), 5+len(subjects)+5):
            ws.column_dimensions[get_column_letter(c)].width = 13

    # ---- ATTENDANCE SHEET ----
    att = wb.create_sheet(title='Attendance')
    att.freeze_panes = 'E3'
    import calendar
    from datetime import date
    today = date.today()
    month_days = calendar.monthrange(today.year, today.month)[1]
    dates = [f'{today.year}-{today.month:02d}-{d:02d}' for d in range(1, month_days + 1)
             if date(today.year, today.month, d).weekday() < 6]  # exclude Sunday

    total_cols_att = 4 + len(dates) + 4
    att.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols_att)
    att.cell(1,1).value = f'SPTAS — Attendance Register | Class {cls}-{sec} | Month: {today.strftime("%B %Y")}'
    att.cell(1,1).font = Font(bold=True, size=13, color='FFFFFF')
    att.cell(1,1).fill = PatternFill(start_color='064E3B', end_color='064E3B', fill_type='solid')
    att.cell(1,1).alignment = Alignment(horizontal='center', vertical='center')
    att.row_dimensions[1].height = 28

    att_headers = ['Roll No', 'Student Name', 'Class', 'Section'] + dates + \
                  ['Present', 'Absent', 'Half Day', 'Attendance %']
    for col, h in enumerate(att_headers, 1):
        att.cell(row=2, column=col).value = h
    style_header(att, 2, len(att_headers), fill_hex='064E3B')

    status_fill = PatternFill(start_color='D1FAE5', end_color='D1FAE5', fill_type='solid')
    for row_i, student in enumerate(class_students, start=3):
        row_data = [student['roll_no'], student['name'], student['class'], student['section']]
        row_data += ['P'] * len(dates)  # default Present
        row_data += ['', '', '', '']    # calculated columns
        for col, val in enumerate(row_data, 1):
            cell = att.cell(row=row_i, column=col, value=val)
            if col <= 4:
                cell.fill = PatternFill(start_color='E8F4F8', end_color='E8F4F8', fill_type='solid')
            elif col <= 4 + len(dates):
                cell.fill = status_fill
            thin = Side(style='thin', color='CCCCCC')
            cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
            cell.alignment = Alignment(horizontal='center', vertical='center')
    att.column_dimensions['A'].width = 10
    att.column_dimensions['B'].width = 24
    att.column_dimensions['C'].width = 8
    att.column_dimensions['D'].width = 10
    for c in range(5, 5 + len(dates) + 4):
        att.column_dimensions[get_column_letter(c)].width = 12

    # ---- KEY SHEET ----
    key = wb.create_sheet(title='Grades & Keys')
    key['A1'] = 'GRADING SYSTEM'; key['A1'].font = Font(bold=True, size=14)
    grade_data = [('Percentage', 'Grade', 'Remarks'),
                  ('90 - 100', 'A+', 'Outstanding'),
                  ('80 - 89', 'A',  'Excellent'),
                  ('70 - 79', 'B+', 'Very Good'),
                  ('60 - 69', 'B',  'Good'),
                  ('50 - 59', 'C',  'Average'),
                  ('33 - 49', 'D',  'Below Average'),
                  ('0  - 32', 'F',  'Fail')]
    for r, row in enumerate(grade_data, start=2):
        for c, val in enumerate(row, start=1):
            key.cell(r, c).value = val
        if r == 2: style_header(key, r, 3)
    key['A12'] = 'ATTENDANCE CODES'; key['A12'].font = Font(bold=True, size=12)
    for r, row in enumerate([('Code','Meaning'),('P','Present'),('A','Absent'),('H','Half Day')], start=13):
        for c, v in enumerate(row, 1): key.cell(r, c).value = v
        if r == 13: style_header(key, r, 2)
    key.column_dimensions['A'].width = 20; key.column_dimensions['B'].width = 12; key.column_dimensions['C'].width = 22

    # Save
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    filename = f'SPTAS_Marks_Template_Class{cls}{sec}.xlsx'
    return send_file(buf, as_attachment=True, download_name=filename,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


# =========================================================
# UPLOAD & PROCESS MARKS EXCEL
# =========================================================
@app.route('/api/excel/upload-marks', methods=['POST'])
def upload_marks_excel():
    if not OPENPYXL_AVAILABLE:
        return jsonify({'success': False, 'message': 'openpyxl not available'}), 500
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file uploaded'}), 400

    f = request.files['file']
    if not f.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'success': False, 'message': 'Only .xlsx files allowed'}), 400

    try:
        wb = openpyxl.load_workbook(io.BytesIO(f.read()), data_only=True)
    except Exception as e:
        return jsonify({'success': False, 'message': f'Cannot read Excel: {str(e)}'}), 400

    students = load_db()
    student_map = {s['roll_no']: s for s in students}  # roll_no -> student
    results_summary = []
    updated_count = 0
    errors = []

    skip_sheets = {'Instructions', 'Grades & Keys', 'Attendance'}

    for sheet_name in wb.sheetnames:
        if sheet_name in skip_sheets:
            continue
        ws = wb[sheet_name]
        exam_name = sheet_name.replace('_', ' ')

        # Read header row (row 2)
        headers = []
        for col in range(1, ws.max_column + 1):
            h = ws.cell(row=2, column=col).value
            headers.append(str(h).strip() if h else '')

        if 'Roll No' not in headers:
            errors.append(f'Sheet "{sheet_name}": No "Roll No" column found, skipped.')
            continue

        roll_col = headers.index('Roll No') + 1
        name_col = headers.index('Student Name') + 1 if 'Student Name' in headers else None
        class_col = headers.index('Class') + 1 if 'Class' in headers else None
        sec_col = headers.index('Section') + 1 if 'Section' in headers else None

        # Identify subject columns (between Section and Total)
        subj_start = max(roll_col, name_col or 0, class_col or 0, sec_col or 0) + 1
        subj_cols = []
        calc_cols = {'Total', 'Percentage', 'Grade', 'Class Rank', 'Remarks'}
        for idx, h in enumerate(headers[subj_start - 1:], start=subj_start):
            if h in calc_cols or not h: break
            subj_cols.append((idx, h))

        # Find max_marks: assume 100 unless a note in title
        title_cell = ws.cell(row=1, column=1).value or ''
        max_marks = 100
        if 'Max/Subject:' in str(title_cell):
            try: max_marks = int(str(title_cell).split('Max/Subject:')[1].strip())
            except: pass

        sheet_rows = []
        for row in range(3, ws.max_row + 1):
            roll = str(ws.cell(row=row, column=roll_col).value or '').strip()
            if not roll or roll == 'None': continue

            subject_scores = {}
            for sc, sname in subj_cols:
                val = ws.cell(row=row, column=sc).value
                try: subject_scores[sname] = float(val or 0)
                except: subject_scores[sname] = 0

            total = sum(subject_scores.values())
            total_max = max_marks * len(subj_cols)
            pct = round((total / total_max) * 100, 2) if total_max > 0 else 0
            grade = get_grade(pct)

            sheet_rows.append({'roll_no': roll, 'subjects': subject_scores,
                                'total': total, 'total_max': total_max,
                                'percentage': pct, 'grade': grade})

        # Calculate class rank (by percentage desc)
        sheet_rows.sort(key=lambda x: -x['percentage'])
        for rank_i, row_data in enumerate(sheet_rows, start=1):
            row_data['rank'] = rank_i

        # Update students DB
        for row_data in sheet_rows:
            s = student_map.get(row_data['roll_no'])
            if not s:
                errors.append(f'Roll No {row_data["roll_no"]} not found in DB, skipped.')
                continue

            exam_entry = {
                'exam_name': exam_name, 'exam': exam_name,
                'year': str(datetime.now().year),
                'subjects': [{'name': sn, 'obtained': sv, 'max': max_marks}
                             for sn, sv in row_data['subjects'].items()],
                'total': row_data['total'], 'total_max': row_data['total_max'],
                'percentage': row_data['percentage'],
                'grade': row_data['grade'], 'rank': row_data['rank']
            }

            if 'examination_progress' not in s: s['examination_progress'] = []
            # Replace existing exam with same name or append
            existing_idx = next((i for i, e in enumerate(s['examination_progress'])
                                 if (e.get('exam_name') or e.get('exam','')) == exam_name), None)
            if existing_idx is not None:
                s['examination_progress'][existing_idx] = exam_entry
            else:
                s['examination_progress'].append(exam_entry)

            # Update subject_performance (latest exam)
            s['subject_performance'] = [{'subject': sn, 'score': round((sv/max_marks)*100)}
                                         for sn, sv in row_data['subjects'].items()]
            # Update performance trend based on progress
            prog = s['examination_progress']
            if len(prog) >= 2:
                pcts = [e.get('percentage', 0) for e in prog[-2:]]
                diff = pcts[-1] - pcts[-2]
                s['performance_trend'] = 'Improving' if diff > 2 else ('Declining' if diff < -2 else 'Stable')

            updated_count += 1
            results_summary.append({
                'roll_no': row_data['roll_no'], 'name': s['name'],
                'exam': exam_name, 'total': row_data['total'],
                'percentage': row_data['percentage'],
                'grade': row_data['grade'], 'rank': row_data['rank']
            })

    if save_db(students):
        return jsonify({'success': True, 'updated': updated_count,
                        'results': results_summary, 'errors': errors})
    return jsonify({'success': False, 'message': 'DB save failed'}), 500


# =========================================================
# UPLOAD & PROCESS ATTENDANCE EXCEL
# =========================================================
@app.route('/api/excel/upload-attendance', methods=['POST'])
def upload_attendance_excel():
    if not OPENPYXL_AVAILABLE:
        return jsonify({'success': False, 'message': 'openpyxl not available'}), 500
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file uploaded'}), 400

    f = request.files['file']
    try:
        wb = openpyxl.load_workbook(io.BytesIO(f.read()), data_only=True)
    except Exception as e:
        return jsonify({'success': False, 'message': f'Cannot read file: {str(e)}'}), 400

    if 'Attendance' not in wb.sheetnames:
        return jsonify({'success': False, 'message': '"Attendance" sheet not found in file'}), 400

    ws = wb['Attendance']
    headers = [str(ws.cell(2, c).value or '').strip() for c in range(1, ws.max_column + 1)]
    roll_col = 1  # always col 1
    date_cols = [(i+1, h) for i, h in enumerate(headers) if h.count('-') == 2 and len(h) == 10]

    students = load_db()
    student_map = {s['roll_no']: s for s in students}
    updated = 0
    for row in range(3, ws.max_row + 1):
        roll = str(ws.cell(row, roll_col).value or '').strip()
        if not roll or roll == 'None': continue
        s = student_map.get(roll)
        if not s: continue
        if 'attendance_records' not in s: s['attendance_records'] = []
        for col, date_str in date_cols:
            code = str(ws.cell(row, col).value or 'P').strip().upper()
            status = 'Present' if code == 'P' else ('Absent' if code == 'A' else 'Half Day')
            existing = next((r for r in s['attendance_records'] if r['date'] == date_str), None)
            if existing: existing['status'] = status
            else: s['attendance_records'].append({'date': date_str, 'status': status})
        # Recalculate attendance %
        recs = s['attendance_records']
        total = len(recs)
        present = sum(1 for r in recs if r['status'] in ['Present', 'Half Day'])
        s['current_status']['attendance_percentage'] = round(present/total*100, 1) if total else 90
        updated += 1

    if save_db(students):
        return jsonify({'success': True, 'updated': updated, 'date_columns': len(date_cols)})
    return jsonify({'success': False, 'message': 'DB save failed'}), 500


# =========================================================
# DOWNLOAD RESULTS REPORT EXCEL
# =========================================================
@app.route('/api/excel/results-report', methods=['GET'])
def download_results_report():
    if not OPENPYXL_AVAILABLE:
        return jsonify({'error': 'openpyxl not installed'}), 500
    cls  = request.args.get('class', '')
    sec  = request.args.get('section', '')
    exam = request.args.get('exam', '')

    students = load_db()
    filtered = [s for s in students if (not cls or str(s['class'])==cls) and
                (not sec or s['section']==sec)]

    wb = openpyxl.Workbook()
    ws = wb.active; ws.title = 'Results Report'

    # Title
    ws.merge_cells('A1:K1')
    ws['A1'] = f'SPTAS — Results Report | Class {cls or "All"}-{sec or "All"} | {exam or "All Exams"}'
    ws['A1'].font = Font(bold=True, size=14, color='FFFFFF')
    ws['A1'].fill = PatternFill(start_color='1E1B4B', end_color='1E1B4B', fill_type='solid')
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 30

    headers = ['Rank','Roll No','Student Name','Class','Section',
               'Exam','Total','Max Marks','Percentage','Grade','Trend']
    for c, h in enumerate(headers, 1): ws.cell(2, c).value = h
    style_header(ws, 2, len(headers))

    rows_data = []
    for s in filtered:
        prog = s.get('examination_progress', [])
        exams_to_report = [e for e in prog if not exam or (e.get('exam_name') or e.get('exam','')) == exam]
        for e in exams_to_report:
            rows_data.append({
                'roll': s['roll_no'], 'name': s['name'],
                'class': s['class'], 'section': s['section'],
                'exam': e.get('exam_name') or e.get('exam',''),
                'total': e.get('total', 0), 'total_max': e.get('total_max', 500),
                'pct': e.get('percentage', 0), 'grade': e.get('grade',''),
                'rank': e.get('rank',''), 'trend': s.get('performance_trend','Stable')
            })

    rows_data.sort(key=lambda x: (-x['pct'], x['roll']))
    grade_colors = {'A+':'D4EDDA','A':'C3E6CB','B+':'D1ECF1','B':'BEE5EB',
                    'C':'FFF3CD','D':'FFE8A1','F':'F8D7DA',''  :'FFFFFF'}

    for r_i, row in enumerate(rows_data, start=3):
        vals = [row['rank'],row['roll'],row['name'],row['class'],row['section'],
                row['exam'],row['total'],row['total_max'],f"{row['pct']}%",row['grade'],row['trend']]
        even = r_i%2==0
        for c, val in enumerate(vals, 1):
            cell = ws.cell(r_i, c, value=val)
            cell.alignment = Alignment(horizontal='center', vertical='center')
            thin = Side(style='thin', color='CCCCCC')
            cell.border = Border(left=thin,right=thin,top=thin,bottom=thin)
            if c == 9:  # Grade col
                gc = grade_colors.get(row['grade'], 'FFFFFF')
                cell.fill = PatternFill(start_color=gc, end_color=gc, fill_type='solid')
                cell.font = Font(bold=True)
            else:
                bg = 'F8F9FA' if even else 'FFFFFF'
                cell.fill = PatternFill(start_color=bg, end_color=bg, fill_type='solid')

    col_widths = [8,10,24,8,10,16,10,10,12,8,12]
    for c, w in enumerate(col_widths, 1): ws.column_dimensions[get_column_letter(c)].width = w

    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    fname = f'SPTAS_Results_{cls or "All"}{sec or ""}.xlsx'
    return send_file(buf, as_attachment=True, download_name=fname,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)

