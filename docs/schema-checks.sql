\set ON_ERROR_STOP 0
INSERT INTO users(email,full_name,role,password_hash) VALUES ('ph@demo.test','Demo Pharmacist','pharmacist','x');
INSERT INTO patients(first_name,last_name,date_of_birth,phone) VALUES ('John','Turner','1985-06-14','+970 59 123 4567') RETURNING patient_code;
\echo '--- expect FAIL: duplicate patient identity (case-insensitive)'
INSERT INTO patients(first_name,last_name,date_of_birth) VALUES ('john','TURNER','1985-06-14');
\echo '--- expect OK: same identity in sandbox'
INSERT INTO patients(first_name,last_name,date_of_birth,is_sandbox) VALUES ('John','Turner','1985-06-14',true);
\echo '--- expect FAIL: future DOB'
INSERT INTO patients(first_name,last_name,date_of_birth) VALUES ('A','B', CURRENT_DATE + 1);
\echo '--- expect FAIL: bad phone'
INSERT INTO patients(first_name,last_name,date_of_birth,phone) VALUES ('A','B','1990-01-01','abc');
INSERT INTO medications(name,strength,form) VALUES ('Lisinopril','10 mg','tablet');
INSERT INTO prescriptions(patient_id,medication_id,prescriber_name,dosage_instructions,quantity,refills_authorized,refills_remaining,start_date)
 VALUES (1,1,'Dr. Fictional','1 tablet daily',30,3,3,'2026-10-01') RETURNING rx_code;
\echo '--- expect FAIL: duplicate active Rx same patient+med'
INSERT INTO prescriptions(patient_id,medication_id,prescriber_name,dosage_instructions,quantity,refills_authorized,refills_remaining,start_date)
 VALUES (1,1,'Dr. Other','1 tablet daily',30,3,3,'2026-10-01');
\echo '--- expect FAIL: refills_remaining > authorized'
INSERT INTO prescriptions(patient_id,medication_id,prescriber_name,dosage_instructions,quantity,refills_authorized,refills_remaining,start_date,status)
 VALUES (1,1,'Dr. X','x',30,2,5,'2026-10-01','completed');
INSERT INTO refill_requests(prescription_id) VALUES (1);
\echo '--- expect FAIL: second pending refill'
INSERT INTO refill_requests(prescription_id) VALUES (1);
\echo '--- expect FAIL: rejected without reason'
UPDATE refill_requests SET status='rejected', reviewed_at=now() WHERE id=1;
\echo '--- expect FAIL: approved without reviewed_at'
UPDATE refill_requests SET status='approved' WHERE id=1;
\echo '--- expect FAIL: resolved ticket without resolution'
INSERT INTO support_tickets(subject,description,category,reporter_name,status) VALUES ('Cannot refill','x','refill','Clinic A','resolved');
INSERT INTO support_tickets(subject,description,category,reporter_name) VALUES ('Cannot process refill request','x','refill','Clinic A') RETURNING ticket_code;
INSERT INTO test_cases(title,module,expected_result) VALUES ('Login with valid credentials','auth','Dashboard shown') RETURNING case_code;
INSERT INTO bug_reports(title,description,environment,steps_to_reproduce,expected_behavior,actual_behavior,severity,priority) VALUES ('t','d','local','s','e','a','major','p2') RETURNING bug_code;
\echo '--- expect FAIL: automation totals mismatch'
INSERT INTO automation_runs(framework,started_at,duration_ms,total,passed,failed,skipped) VALUES ('playwright',now(),1000,5,3,1,0);
