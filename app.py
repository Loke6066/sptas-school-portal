import os
import json
from flask import Flask, render_template, jsonify, request
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'sptas-school-secret-2026')

DB_DIR = os.path.dirname(__file__)

# =========================================================
# DATABASE HELPERS
# =========================================================

def load_json(filename):
    path = os.path.join(DB_DIR, filename)
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        app.logger.error(f"Error loading {filename}: {e}")
        return [] if filename.endswith('db.json') else {}

def save_json(filename, data):
    path = os.path.join(DB_DIR, filename)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        app.logger.error(f"Error saving {filename}: {e}")
        return False

def load_db():     return load_json('students_db.json')
def save_db(d):    return save_json('students_db.json', d)
def load_teachers(): return load_json('teachers_db.json')
def save_teachers(d): return save_json('teachers_db.json', d)
def load_timetables(): return load_json('timetables_db.json')
def save_timetables(d): return save_json('timetables_db.json', d)
def load_settings(): return load_json('settings.json')
def save_settings(d): return save_json('settings.json', d)

def clean_phone(phone):
    if not phone:
        return ""
    return phone.replace(" ", "").replace("-", "").replace("+91", "").strip()

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
    total_students = len(students)
    active_classes = len(set(f"{s['class']}-{s['section']}" for s in students))
    if total_students > 0:
        avg_att = sum(s["current_status"]["attendance_percentage"] for s in students) / total_students
        avg_attendance = f"{avg_att:.1f}%"
    else:
        avg_attendance = "92.4%"
    return jsonify({
        "total_students": total_students,
        "active_classes": active_classes,
        "overall_attendance": avg_attendance,
        "teachers": len(teachers)
    })

# =========================================================
# SETTINGS (Principal Name etc.)
# =========================================================

@app.route('/api/settings', methods=['GET'])
def get_settings():
    s = load_settings()
    return jsonify({"success": True, "principal_name": s.get("principal_name", "Principal"), "school_name": s.get("school_name", "Silverwood International School")})

@app.route('/api/settings/update', methods=['POST'])
def update_settings():
    data = request.get_json() or {}
    s = load_settings()
    if "principal_name" in data:
        s["principal_name"] = data["principal_name"].strip()
    if "school_name" in data:
        s["school_name"] = data["school_name"].strip()
    if save_settings(s):
        return jsonify({"success": True})
    return jsonify({"success": False}), 500

# =========================================================
# AUTHENTICATION
# =========================================================

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    role = data.get("role", "")

    if role == "principal":
        username = data.get("username", "")
        password = data.get("password", "")
        s = load_settings()
        if username == s.get("principal_username", "principal") and password == s.get("principal_password", "principal123"):
            return jsonify({"success": True, "role": "principal", "name": s.get("principal_name", "Dr. Shanti Swaroop (Principal)")})
        return jsonify({"success": False, "message": "Invalid Principal username or password."})

    elif role == "teacher":
        phone = clean_phone(data.get("phone", ""))
        password = data.get("password", "").strip()
        teachers = load_teachers()
        for t in teachers:
            if clean_phone(t.get("phone", "")) == phone:
                saved_pwd = t.get("password", "")
                if saved_pwd == "":
                    # First login — allow through, require password setup
                    return jsonify({"success": True, "role": "teacher", "teacher_id": t["id"],
                                    "name": t["name"], "require_password_setup": True})
                elif saved_pwd == password:
                    return jsonify({"success": True, "role": "teacher", "teacher_id": t["id"],
                                    "name": t["name"], "require_password_setup": False})
                else:
                    return jsonify({"success": False, "message": "Incorrect password."})
        return jsonify({"success": False, "message": "Phone number not found in teacher records."})

    elif role == "parent":
        roll_no = data.get("roll_no", "").strip()
        phone_no = data.get("phone_no", "").strip()
        password = data.get("password", "").strip()
        if not roll_no or not phone_no:
            return jsonify({"success": False, "message": "Roll Number and Phone Number are required."})
        students = load_db()
        clean_input_phone = clean_phone(phone_no)
        for s in students:
            if s["roll_no"] == roll_no or s["id"] == roll_no:
                contact_match = (clean_phone(s.get("parent_contact", "")) == clean_input_phone or
                                 clean_phone(s.get("parent_alt_contact", "")) == clean_input_phone)
                if contact_match:
                    saved_pwd = s.get("parent_password", "")
                    if saved_pwd != "":
                        if saved_pwd == password:
                            return jsonify({"success": True, "role": "parent", "student_id": s["id"],
                                            "name": s["parent_name"], "require_password_setup": False})
                        else:
                            return jsonify({"success": False, "message": "Incorrect Password."})
                    else:
                        return jsonify({"success": True, "role": "parent", "student_id": s["id"],
                                        "name": s["parent_name"], "require_password_setup": True})
        return jsonify({"success": False, "message": "Roll Number and Parent's Phone Number do not match."})

    return jsonify({"success": False, "message": "Invalid login role specified."})

# =========================================================
# TEACHER PASSWORD SETUP
# =========================================================

@app.route('/api/teacher/set-password', methods=['POST'])
def teacher_set_password():
    data = request.get_json() or {}
    teacher_id = data.get("teacher_id", "")
    new_password = data.get("password", "").strip()
    if not teacher_id or not new_password:
        return jsonify({"success": False, "message": "Missing data."}), 400
    teachers = load_teachers()
    for t in teachers:
        if t["id"] == teacher_id:
            t["password"] = new_password
            if save_teachers(teachers):
                return jsonify({"success": True})
            return jsonify({"success": False}), 500
    return jsonify({"success": False, "message": "Teacher not found."}), 404

# =========================================================
# PARENT PASSWORD & FEEDBACK
# =========================================================

@app.route('/api/parent/set-password', methods=['POST'])
def parent_set_password():
    data = request.get_json() or {}
    student_id = data.get("student_id", "")
    new_password = data.get("password", "").strip()
    if not student_id or not new_password:
        return jsonify({"success": False, "message": "Missing credentials."}), 400
    students = load_db()
    for s in students:
        if s["id"] == student_id:
            s["parent_password"] = new_password
            if save_db(students):
                return jsonify({"success": True, "message": "Password updated successfully."})
            return jsonify({"success": False}), 500
    return jsonify({"success": False, "message": "Student not found."}), 404

@app.route('/api/parent/feedback', methods=['POST'])
def parent_submit_feedback():
    data = request.get_json() or {}
    student_id = data.get("student_id", "")
    feedback = data.get("feedback", "").strip()
    if not student_id:
        return jsonify({"success": False, "message": "Missing student identification."}), 400
    students = load_db()
    for s in students:
        if s["id"] == student_id:
            s["parent_feedback"] = feedback
            if save_db(students):
                return jsonify({"success": True, "message": "Feedback submitted successfully."})
            return jsonify({"success": False}), 500
    return jsonify({"success": False, "message": "Student not found."}), 404

# =========================================================
# PRINCIPAL REPLY
# =========================================================

@app.route('/api/principal/reply', methods=['POST'])
def principal_reply():
    data = request.get_json() or {}
    student_id = data.get("student_id", "")
    reply = data.get("reply", "").strip()
    if not student_id:
        return jsonify({"success": False, "message": "Missing student identification."}), 400
    students = load_db()
    for s in students:
        if s["id"] == student_id:
            s["principal_reply"] = reply
            if save_db(students):
                return jsonify({"success": True, "message": "Reply saved."})
            return jsonify({"success": False}), 500
    return jsonify({"success": False, "message": "Student not found."}), 404

# =========================================================
# TEACHER CRUD (Principal manages teachers)
# =========================================================

@app.route('/api/teachers', methods=['GET'])
def get_all_teachers():
    teachers = load_teachers()
    # Don't expose passwords
    safe = []
    for t in teachers:
        safe.append({
            "id": t["id"], "name": t["name"], "phone": t["phone"],
            "subjects": t.get("subjects", []), "class": t.get("class", ""),
            "section": t.get("section", ""), "attendance_status": t.get("attendance_status", "Present"),
            "email": t.get("email", ""), "has_password": bool(t.get("password", ""))
        })
    return jsonify(safe)

@app.route('/api/teacher/create', methods=['POST'])
def create_teacher():
    data = request.get_json() or {}
    phone = clean_phone(data.get("phone", ""))
    name = data.get("name", "").strip()
    if not phone or not name:
        return jsonify({"success": False, "message": "Name and Phone are required."}), 400
    if len(phone) > 10:
        return jsonify({"success": False, "message": "Phone number must be 10 digits or less."}), 400
    teachers = load_teachers()
    for t in teachers:
        if clean_phone(t.get("phone", "")) == phone:
            return jsonify({"success": False, "message": "Teacher with this phone already exists."}), 400
    import time
    new_teacher = {
        "id": f"t{int(time.time())}",
        "name": name,
        "phone": phone,
        "password": "",
        "subjects": data.get("subjects", []),
        "class": data.get("class", ""),
        "section": data.get("section", ""),
        "attendance_status": "Present",
        "email": data.get("email", "")
    }
    teachers.append(new_teacher)
    if save_teachers(teachers):
        return jsonify({"success": True, "message": "Teacher created.", "teacher_id": new_teacher["id"]})
    return jsonify({"success": False}), 500

@app.route('/api/teacher/update/<teacher_id>', methods=['POST'])
def update_teacher(teacher_id):
    data = request.get_json() or {}
    phone = clean_phone(data.get("phone", ""))
    if phone and len(phone) > 10:
        return jsonify({"success": False, "message": "Phone number must be 10 digits or less."}), 400
    teachers = load_teachers()
    for t in teachers:
        if t["id"] == teacher_id:
            if data.get("name"): t["name"] = data["name"].strip()
            if phone: t["phone"] = phone
            if "subjects" in data: t["subjects"] = data["subjects"]
            if "class" in data: t["class"] = data["class"]
            if "section" in data: t["section"] = data["section"]
            if "email" in data: t["email"] = data["email"]
            if "attendance_status" in data: t["attendance_status"] = data["attendance_status"]
            if save_teachers(teachers):
                return jsonify({"success": True})
            return jsonify({"success": False}), 500
    return jsonify({"success": False, "message": "Teacher not found."}), 404

@app.route('/api/teacher/delete/<teacher_id>', methods=['POST', 'DELETE'])
def delete_teacher(teacher_id):
    teachers = load_teachers()
    new_list = [t for t in teachers if t["id"] != teacher_id]
    if len(new_list) == len(teachers):
        return jsonify({"success": False, "message": "Teacher not found."}), 404
    if save_teachers(new_list):
        return jsonify({"success": True})
    return jsonify({"success": False}), 500

@app.route('/api/teacher/attendance', methods=['POST'])
def update_teacher_attendance():
    data = request.get_json() or {}
    teacher_id = data.get("teacher_id", "")
    status = data.get("status", "Present")
    teachers = load_teachers()
    for t in teachers:
        if t["id"] == teacher_id:
            t["attendance_status"] = status
            if save_teachers(teachers):
                return jsonify({"success": True})
            return jsonify({"success": False}), 500
    return jsonify({"success": False, "message": "Teacher not found."}), 404

# =========================================================
# TIMETABLE (Class-wise)
# =========================================================

@app.route('/api/timetable/<class_key>', methods=['GET'])
def get_timetable(class_key):
    """class_key = "10-A", "5-B" etc."""
    timetables = load_timetables()
    if class_key in timetables:
        return jsonify({"success": True, "timetable": timetables[class_key]})
    return jsonify({"success": True, "timetable": None})

@app.route('/api/timetable/save', methods=['POST'])
def save_timetable():
    data = request.get_json() or {}
    class_key = data.get("class_key", "")  # e.g. "10-A"
    timetable = data.get("timetable", {})
    if not class_key:
        return jsonify({"success": False, "message": "Class key required."}), 400
    timetables = load_timetables()
    timetables[class_key] = timetable
    if save_timetables(timetables):
        # Propagate to all students in this class-section
        parts = class_key.split("-")
        if len(parts) == 2:
            cls, sec = parts[0], parts[1]
            students = load_db()
            updated = False
            for s in students:
                if s["class"] == cls and s["section"] == sec:
                    s["timetable"] = timetable
                    updated = True
            if updated:
                save_db(students)
        return jsonify({"success": True})
    return jsonify({"success": False}), 500

@app.route('/api/timetable/classes', methods=['GET'])
def get_timetable_classes():
    timetables = load_timetables()
    return jsonify({"classes": list(timetables.keys())})

# =========================================================
# ATTENDANCE (Student)
# =========================================================

@app.route('/api/attendance/save', methods=['POST'])
def save_attendance():
    """Save attendance for a list of students for a given date."""
    data = request.get_json() or {}
    date = data.get("date", "")
    records = data.get("records", [])  # [{student_id, status}]
    if not date or not records:
        return jsonify({"success": False, "message": "Date and records required."}), 400
    students = load_db()
    updated_count = 0
    for rec in records:
        sid = rec.get("student_id", "")
        status = rec.get("status", "Present")  # "Present", "Absent", "Half Day"
        for s in students:
            if s["id"] == sid:
                if "attendance_records" not in s:
                    s["attendance_records"] = []
                # Update or insert record for this date
                existing = next((r for r in s["attendance_records"] if r["date"] == date), None)
                if existing:
                    existing["status"] = status
                else:
                    s["attendance_records"].append({"date": date, "status": status})
                # Update daily attendance_status
                s["attendance_status"] = "Absent" if status == "Absent" else "Present"
                updated_count += 1
                break
    if save_db(students):
        return jsonify({"success": True, "updated": updated_count})
    return jsonify({"success": False}), 500

@app.route('/api/attendance/report', methods=['GET'])
def get_attendance_report():
    """Get monthly attendance report for class-section or all."""
    class_filter = request.args.get('class', '')
    section_filter = request.args.get('section', '')
    month = request.args.get('month', '')  # YYYY-MM
    students = load_db()
    report = []
    for s in students:
        if class_filter and s["class"] != class_filter:
            continue
        if section_filter and s["section"] != section_filter:
            continue
        records = s.get("attendance_records", [])
        if month:
            monthly_records = [r for r in records if r["date"].startswith(month)]
        else:
            monthly_records = records
        present_days = sum(1 for r in monthly_records if r["status"] in ["Present", "Half Day"])
        absent_days = sum(1 for r in monthly_records if r["status"] == "Absent")
        half_days = sum(1 for r in monthly_records if r["status"] == "Half Day")
        total_days = len(monthly_records)
        report.append({
            "id": s["id"],
            "name": s["name"],
            "roll_no": s["roll_no"],
            "class": s["class"],
            "section": s["section"],
            "present_days": present_days,
            "absent_days": absent_days,
            "half_days": half_days,
            "total_days": total_days,
            "percentage": round((present_days / total_days * 100), 1) if total_days > 0 else 0,
            "records": monthly_records
        })
    return jsonify(report)

@app.route('/api/attendance/class', methods=['GET'])
def get_class_students_attendance():
    """Get students list for attendance marking."""
    class_filter = request.args.get('class', '')
    section_filter = request.args.get('section', '')
    date = request.args.get('date', '')
    students = load_db()
    result = []
    for s in students:
        if class_filter and s["class"] != class_filter:
            continue
        if section_filter and s["section"] != section_filter:
            continue
        existing_status = "Present"
        if date:
            records = s.get("attendance_records", [])
            rec = next((r for r in records if r["date"] == date), None)
            if rec:
                existing_status = rec["status"]
        result.append({
            "id": s["id"],
            "name": s["name"],
            "roll_no": s["roll_no"],
            "attendance_status": existing_status
        })
    result.sort(key=lambda x: x["roll_no"])
    return jsonify(result)

# =========================================================
# STUDENT CRUD (Admins)
# =========================================================

@app.route('/api/admin/student/create', methods=['POST'])
def admin_create_student():
    student_data = request.get_json() or {}
    parent_contact = clean_phone(student_data.get("parent_contact", ""))
    if not parent_contact:
        return jsonify({"success": False, "message": "Parent Contact Number is mandatory!"}), 400
    if len(parent_contact) > 10:
        return jsonify({"success": False, "message": "Parent contact must be 10 digits or less."}), 400

    name = student_data.get("name", "").strip()
    roll_no = student_data.get("roll_no", "").strip()
    if not name or not roll_no:
        return jsonify({"success": False, "message": "Name and Roll Number are required!"}), 400

    students = load_db()
    s_class = student_data.get("class", "10")
    s_section = student_data.get("section", "A")
    for s in students:
        if s["class"] == s_class and s["section"] == s_section and s["roll_no"] == roll_no:
            return jsonify({"success": False, "message": f"Roll number {roll_no} already exists in Class {s_class}-{s_section}."}), 400

    import time
    student_id = str(int(time.time()))
    class_key = f"{s_class}-{s_section}"

    # Get timetable for this class if available
    timetables = load_timetables()
    class_timetable = timetables.get(class_key, {})

    # Build default timetable if not found
    if not class_timetable:
        class_timetable = {
            "Monday": [
                {"period": "1", "time": "08:30 AM - 09:30 AM", "subject": "Mathematics", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Recess", "time": "10:30 AM - 10:45 AM", "subject": "Break Time", "teacher": "-", "room": "Courtyard", "status": "Recess"},
                {"period": "2", "time": "10:45 AM - 11:45 AM", "subject": "English", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Lunch", "time": "12:45 PM - 01:30 PM", "subject": "Lunch Break", "teacher": "-", "room": "Cafeteria", "status": "Break"},
                {"period": "3", "time": "01:30 PM - 02:30 PM", "subject": "Science", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"}
            ],
            "Tuesday": [
                {"period": "1", "time": "08:30 AM - 09:30 AM", "subject": "English", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Recess", "time": "10:30 AM - 10:45 AM", "subject": "Break Time", "teacher": "-", "room": "Courtyard", "status": "Recess"},
                {"period": "2", "time": "10:45 AM - 11:45 AM", "subject": "Mathematics", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Lunch", "time": "12:45 PM - 01:30 PM", "subject": "Lunch Break", "teacher": "-", "room": "Cafeteria", "status": "Break"},
                {"period": "3", "time": "01:30 PM - 02:30 PM", "subject": "Hindi", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"}
            ],
            "Wednesday": [
                {"period": "1", "time": "08:30 AM - 09:30 AM", "subject": "Science", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Recess", "time": "10:30 AM - 10:45 AM", "subject": "Break Time", "teacher": "-", "room": "Courtyard", "status": "Recess"},
                {"period": "2", "time": "10:45 AM - 11:45 AM", "subject": "Social Studies", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Lunch", "time": "12:45 PM - 01:30 PM", "subject": "Lunch Break", "teacher": "-", "room": "Cafeteria", "status": "Break"},
                {"period": "3", "time": "01:30 PM - 02:30 PM", "subject": "Mathematics", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"}
            ],
            "Thursday": [
                {"period": "1", "time": "08:30 AM - 09:30 AM", "subject": "Hindi", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Recess", "time": "10:30 AM - 10:45 AM", "subject": "Break Time", "teacher": "-", "room": "Courtyard", "status": "Recess"},
                {"period": "2", "time": "10:45 AM - 11:45 AM", "subject": "English", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Lunch", "time": "12:45 PM - 01:30 PM", "subject": "Lunch Break", "teacher": "-", "room": "Cafeteria", "status": "Break"},
                {"period": "3", "time": "01:30 PM - 02:30 PM", "subject": "Science", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"}
            ],
            "Friday": [
                {"period": "1", "time": "08:30 AM - 09:30 AM", "subject": "Social Studies", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Recess", "time": "10:30 AM - 10:45 AM", "subject": "Break Time", "teacher": "-", "room": "Courtyard", "status": "Recess"},
                {"period": "2", "time": "10:45 AM - 11:45 AM", "subject": "Mathematics", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"},
                {"period": "Lunch", "time": "12:45 PM - 01:30 PM", "subject": "Lunch Break", "teacher": "-", "room": "Cafeteria", "status": "Break"},
                {"period": "3", "time": "01:30 PM - 02:30 PM", "subject": "English", "teacher": "Class Teacher", "room": "Room 1", "status": "Class In Progress"}
            ]
        }

    new_student = {
        "id": student_id,
        "name": name,
        "roll_no": roll_no,
        "admission_no": student_data.get("admission_no", ""),
        "class": s_class,
        "section": s_section,
        "academic_year": student_data.get("academic_year", "2025-26"),
        "dob": student_data.get("dob", "2011-01-01"),
        "parent_name": student_data.get("parent_name", "Parent Name"),
        "parent_contact": parent_contact,
        "parent_alt_contact": student_data.get("parent_alt_contact", ""),
        "parent_password": "",
        "parent_feedback": "",
        "principal_reply": "",
        "attendance_status": student_data.get("attendance_status", "Present"),
        "attendance_records": [],
        "current_status": {
            "standard": f"Class {s_class}",
            "section": f"Section {s_section}",
            "class_teacher": student_data.get("class_teacher", "Class Teacher"),
            "attendance_percentage": float(student_data.get("attendance_percentage", 90.0)),
            "subjects": student_data.get("subjects", ["Mathematics", "Science", "Social Studies", "English", "Hindi", "Computer Science"])
        },
        "timetable": class_timetable,
        "examination_progress": student_data.get("examination_progress", []),
        "subject_performance": student_data.get("subject_performance", []),
        "progress_comparison": student_data.get("progress_comparison", []),
        "performance_trend": student_data.get("performance_trend", "Stable"),
        "teacher_term_remarks": student_data.get("teacher_term_remarks", []),
        "behavioral_observation": student_data.get("behavioral_observation", {
            "discipline": 4, "leadership": 4, "participation": 4, "communication": 4, "teamwork": 4, "confidence": 4
        }),
        "co_curricular_activities": student_data.get("co_curricular_activities", []),
        "awards": student_data.get("awards", []),
        "parent_meetings": student_data.get("parent_meetings", [])
    }

    students.append(new_student)
    if save_db(students):
        return jsonify({"success": True, "message": "Student created successfully.", "student_id": student_id})
    return jsonify({"success": False, "message": "Failed to save student profile."}), 500

@app.route('/api/admin/student/update/<student_id>', methods=['POST'])
def admin_update_student(student_id):
    student_data = request.get_json() or {}
    students = load_db()

    for s in students:
        if s["id"] == student_id:
            old_pwd = s.get("parent_password", "")
            old_feedback = s.get("parent_feedback", "")
            old_reply = s.get("principal_reply", "")

            s["name"] = student_data.get("name", s["name"])
            s["roll_no"] = student_data.get("roll_no", s["roll_no"])
            s["admission_no"] = student_data.get("admission_no", s["admission_no"])
            s["class"] = student_data.get("class", s["class"])
            s["section"] = student_data.get("section", s["section"])
            s["dob"] = student_data.get("dob", s["dob"])
            s["academic_year"] = student_data.get("academic_year", s["academic_year"])
            s["parent_name"] = student_data.get("parent_name", s["parent_name"])

            if "current_status" not in s:
                s["current_status"] = {}
            s["current_status"]["standard"] = f"Class {s['class']}"
            s["current_status"]["section"] = f"Section {s['section']}"

            parent_contact = clean_phone(student_data.get("parent_contact", ""))
            if not parent_contact:
                return jsonify({"success": False, "message": "Parent Contact Number is mandatory!"}), 400
            if len(parent_contact) > 10:
                return jsonify({"success": False, "message": "Parent contact must be 10 digits or less."}), 400
            s["parent_contact"] = parent_contact
            s["parent_alt_contact"] = student_data.get("parent_alt_contact", s.get("parent_alt_contact", ""))
            s["attendance_status"] = student_data.get("attendance_status", s.get("attendance_status", "Present"))

            s["current_status"]["attendance_percentage"] = float(student_data.get("attendance_percentage", s["current_status"]["attendance_percentage"]))
            s["performance_trend"] = student_data.get("performance_trend", s["performance_trend"])

            if "timetable" in student_data:
                s["timetable"] = student_data["timetable"]
                for other in students:
                    if other["id"] != student_id and other["class"] == s["class"] and other["section"] == s["section"]:
                        other["timetable"] = student_data["timetable"]

            if "examination_progress" in student_data:
                s["examination_progress"] = student_data["examination_progress"]
            if "subject_performance" in student_data:
                s["subject_performance"] = student_data["subject_performance"]
            if "subjects" in student_data:
                s["current_status"]["subjects"] = student_data["subjects"]
            if "progress_comparison" in student_data:
                s["progress_comparison"] = student_data["progress_comparison"]
            if "teacher_term_remarks" in student_data:
                s["teacher_term_remarks"] = student_data["teacher_term_remarks"]
            if "behavioral_observation" in student_data:
                s["behavioral_observation"] = student_data["behavioral_observation"]
            if "co_curricular_activities" in student_data:
                s["co_curricular_activities"] = student_data["co_curricular_activities"]
            if "awards" in student_data:
                s["awards"] = student_data["awards"]
            if "parent_meetings" in student_data:
                s["parent_meetings"] = student_data["parent_meetings"]

            s["parent_password"] = old_pwd
            s["parent_feedback"] = old_feedback
            s["principal_reply"] = student_data.get("principal_reply", old_reply)

            if save_db(students):
                return jsonify({"success": True, "message": "Student updated successfully."})
            return jsonify({"success": False, "message": "Failed to save updates to database."}), 500

    return jsonify({"success": False, "message": "Student not found."}), 404

@app.route('/api/admin/student/delete/<student_id>', methods=['POST', 'DELETE'])
def admin_delete_student(student_id):
    students = load_db()
    new_students = [s for s in students if s["id"] != student_id]
    if len(new_students) == len(students):
        return jsonify({"success": False, "message": "Student not found."}), 404
    if save_db(new_students):
        return jsonify({"success": True, "message": "Student deleted successfully."})
    return jsonify({"success": False, "message": "Failed to update database."}), 500

# =========================================================
# SEARCH & STUDENT DATA
# =========================================================

@app.route('/api/search', methods=['GET'])
def search_students():
    query = request.args.get('q', '').strip().lower()
    class_filter = request.args.get('class', '')
    section_filter = request.args.get('section', '')
    students = load_db()

    def make_summary(s):
        return {
            "id": s["id"], "name": s["name"], "admission_no": s["admission_no"],
            "roll_no": s["roll_no"], "class": s["class"], "section": s["section"],
            "parent_name": s["parent_name"], "parent_contact": s["parent_contact"],
            "attendance": s["current_status"]["attendance_percentage"],
            "trend": s["performance_trend"],
            "parent_feedback": s.get("parent_feedback", ""),
            "principal_reply": s.get("principal_reply", ""),
            "attendance_status": s.get("attendance_status", "Present")
        }

    results = []
    for s in students:
        if class_filter and s["class"] != class_filter:
            continue
        if section_filter and s["section"] != section_filter:
            continue
        if not query:
            results.append(make_summary(s))
            continue
        match = (query in s['name'].lower() or
                 query in s.get('admission_no', '').lower() or
                 query == s['roll_no'] or
                 query in s.get('parent_contact', '').replace(" ", "").replace("-", "") or
                 query in s.get('parent_alt_contact', '').replace(" ", "").replace("-", ""))
        if match:
            results.append(make_summary(s))

    return jsonify(results)

@app.route('/api/student/<student_id>', methods=['GET'])
def get_student_details(student_id):
    students = load_db()
    for s in students:
        if s['id'] == student_id:
            return jsonify(s)
    return jsonify({"error": "Student not found"}), 404

@app.route('/api/classes', methods=['GET'])
def get_classes():
    students = load_db()
    classes = sorted(set(f"{s['class']}-{s['section']}" for s in students))
    return jsonify(classes)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
