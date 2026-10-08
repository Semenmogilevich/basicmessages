import { table, integer, text, json } from 'sdk/db';

export const states = table('states', {
  adminId: integer('admin_id').primaryKey(),
  step: text('step').notNull().default('idle'),
  channelId: text('channel_id'),
  channelTitle: text('channel_title'),
  channelUsername: text('channel_username'), // Needed for parsing
  templateText: text('template_text'),
  templateEntities: json('template_entities'),
  links: json('links'),
  linkIndex: integer('link_index').default(0),
  rangeType: text('range_type').default('all'),
  rangeStartX: integer('range_start_x').default(0),
  rangeEndY: integer('range_end_y').default(0),
  targetIds: json('target_ids') // Array of active valid IDs
});
