import os
import json
import random
import string
from flask import Flask, render_template, jsonify, request
from datetime import datetime

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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
