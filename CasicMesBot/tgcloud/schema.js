import { table, integer, text, json, sql } from 'sdk/db';

export const states = table('states', {
  adminId: integer('admin_id').primaryKey(),
  step: text('step').notNull().default('idle'),
  channelId: text('channel_id'),
  channelTitle: text('channel_title'),
  templateText: text('template_text'),
  templateEntities: json('template_entities'), // Store as JSON for custom_emoji_id preservation
  links: json('links'), // Array of strings loaded from .txt file
  linkIndex: integer('link_index').default(0), // Keep track of which link to use next
  rangeType: text('range_type').default('all'),
  rangeParam: integer('range_param').default(0),
});
