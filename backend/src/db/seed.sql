-- Sample data. Passwords are bcrypt hashes of "password123" (see README to regenerate).
INSERT INTO teams (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Field Ops - North'),
  ('22222222-2222-2222-2222-222222222222', 'Field Ops - South');

-- Development credentials are listed in README.md; replace these hashes before production.
INSERT INTO users (id, email, password_hash, full_name, role, team_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@gmail.com',   '$2b$10$0caJI7SwcKjbAlwyJgdFmeDuIIoQ4G/SKw96cTXhxYM2RKIoemFcC', 'Ada Admin',   'admin',   NULL),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager@gmail.com', '$2b$10$7Qo6RagQVsEpRSTUlUpheev0e.qAMmZfwZS6WYIS0aPXEufaAlY4G', 'Mona Manager','manager', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'worker@gmail.com',  '$2b$10$fikOJpoMsgWUg0OF0gXt0.x1FrCMnLmY4iFeXSyMn/098S63/CFlC', 'Wes Worker',  'worker',  '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'worker2@gmail.com',  '$2b$10$fikOJpoMsgWUg0OF0gXt0.x1FrCMnLmY4iFeXSyMn/098S63/CFlC', 'Wanda Worker','worker',  '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'worker3@gmail.com',  '$2b$10$fikOJpoMsgWUg0OF0gXt0.x1FrCMnLmY4iFeXSyMn/098S63/CFlC', 'Will Worker', 'worker',  '11111111-1111-1111-1111-111111111111');

INSERT INTO manager_team_access (manager_id, team_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
