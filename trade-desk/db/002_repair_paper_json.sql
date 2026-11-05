-- Idempotent repair for initial paper-journal payloads encoded twice by postgres.js.
-- Preserve source timestamps, decisions and every financial field. Do not reset records.
UPDATE tradedesk.td_control
SET data=jsonb_set(data,'{accountReadiness}',(data->>'accountReadiness')::jsonb)
WHERE id=1 AND jsonb_typeof(data->'accountReadiness')='string';
UPDATE tradedesk.td_events SET data=(data#>>'{}')::jsonb WHERE jsonb_typeof(data)='string';
UPDATE tradedesk.forward_observations SET data=(data#>>'{}')::jsonb WHERE jsonb_typeof(data)='string';
