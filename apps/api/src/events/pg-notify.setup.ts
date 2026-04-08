import { DataSource } from 'typeorm';

const TRIGGER_SQL = `
-- comment_change
CREATE OR REPLACE FUNCTION notify_comment_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('comment_change', json_build_object(
    'id', NEW.id,
    'task_id', NEW.task_id,
    'action', TG_OP
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comment_change_trigger ON comment;
CREATE TRIGGER comment_change_trigger
  AFTER INSERT ON comment
  FOR EACH ROW EXECUTE FUNCTION notify_comment_change();

-- task_change
CREATE OR REPLACE FUNCTION notify_task_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('task_change', json_build_object(
    'id', NEW.id,
    'action', TG_OP
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_change_trigger ON task;
CREATE TRIGGER task_change_trigger
  AFTER INSERT OR UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION notify_task_change();

-- wake_event_change
CREATE OR REPLACE FUNCTION notify_wake_event_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('wake_event_change', json_build_object(
    'id', NEW.id,
    'action', TG_OP
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wake_event_change_trigger ON wake_event;
CREATE TRIGGER wake_event_change_trigger
  AFTER INSERT OR UPDATE ON wake_event
  FOR EACH ROW EXECUTE FUNCTION notify_wake_event_change();
`;

export async function setupPgNotifyTriggers(dataSource: DataSource): Promise<void> {
  await dataSource.query(TRIGGER_SQL);
}
