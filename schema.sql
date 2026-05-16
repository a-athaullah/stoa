-- Stoa Database Schema
-- Multi-participant AI conversation platform

CREATE DATABASE IF NOT EXISTS stoa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE stoa;

-- All participants: human or AI
CREATE TABLE IF NOT EXISTS actors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type ENUM('human', 'ai') NOT NULL,
  adapter ENUM('local', 'ssh', 'api') DEFAULT NULL,
  adapter_config JSON DEFAULT NULL,
  avatar_color VARCHAR(20) DEFAULT NULL,
  avatar_symbol VARCHAR(10) DEFAULT NULL,
  secret VARCHAR(64) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversation rooms
CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  created_by INT NOT NULL,
  max_ai_turns INT DEFAULT 5,
  workdir_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES actors(id)
);

-- Who's in each room
CREATE TABLE IF NOT EXISTS room_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  actor_id INT NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  invited_by INT DEFAULT NULL,
  notify_on_message BOOLEAN DEFAULT TRUE,
  auto_respond BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (actor_id) REFERENCES actors(id),
  UNIQUE KEY unique_participant (room_id, actor_id)
);

-- Conversation messages
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  participant_id INT NOT NULL,
  content TEXT NOT NULL,
  state ENUM('pending', 'streaming', 'complete', 'error') DEFAULT 'complete',
  reply_to INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id)
);

-- Claude session IDs per participant per room (for --resume)
CREATE TABLE IF NOT EXISTS ai_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  participant_id INT NOT NULL UNIQUE,
  claude_session_id VARCHAR(100) NOT NULL,
  status ENUM('active', 'idle') DEFAULT 'idle',
  last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (participant_id) REFERENCES room_participants(id)
);

-- AI-suggested invites, pending human approval
CREATE TABLE IF NOT EXISTS invite_suggestions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  suggested_by_participant_id INT NOT NULL,
  suggested_actor_id INT NOT NULL,
  reason TEXT DEFAULT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (suggested_by_participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (suggested_actor_id) REFERENCES actors(id)
);

-- Working directories discovered per AI agent
CREATE TABLE IF NOT EXISTS agent_workdirs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NOT NULL,
  path VARCHAR(500) NOT NULL,
  label VARCHAR(200) DEFAULT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE,
  UNIQUE KEY unique_actor_path (actor_id, path)
);

-- Skills discovered per agent (global or per workdir)
CREATE TABLE IF NOT EXISTS agent_skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NOT NULL,
  workdir_id INT DEFAULT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT DEFAULT NULL,
  scope ENUM('global','project','local') DEFAULT 'project',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE,
  FOREIGN KEY (workdir_id) REFERENCES agent_workdirs(id) ON DELETE CASCADE
);

-- Global and per-room settings
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('global', 'room') NOT NULL DEFAULT 'global',
  scope_id INT DEFAULT NULL,
  key_name VARCHAR(100) NOT NULL,
  value VARCHAR(500) NOT NULL,
  UNIQUE KEY unique_setting (scope, scope_id, key_name)
);

-- Default settings
INSERT IGNORE INTO settings (scope, key_name, value) VALUES
  ('global', 'idle_timeout_seconds', '300'),
  ('global', 'max_active_rooms_per_ai', '3'),
  ('global', 'max_ai_turns_per_round', '5');

-- No default actors — first-run setup will create the human actor via UI
