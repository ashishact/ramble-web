# Datasets — Structured Knowledge from Conversation

## Problem

The memory system stores individual facts ("Device A has IP68 certification") but cannot answer structural queries across many items ("which devices have IP68?"). Memories are flat text — there's no column to filter or aggregate against.

Users with domain knowledge (e.g., medical device companies tracking certifications across products) need structured, queryable data that evolves through conversation.

## Approach: Upload-First, Conversation-Maintained

Datasets are always created from explicit uploads (CSV, Excel, markdown table). Never auto-created from conversation. The upload defines the schema and initial data.

Once a dataset exists, the system:
1. Recognizes when conversation matches an existing dataset's schema
2. Auto-inserts or updates rows (the schema constrains what goes where)
3. Answers queries by searching the dataset
4. Evolves schema when needed (add columns, never delete)

### Why upload-first?

- **Schema is never guessed** — it comes from the user's file, always correct
- **No "should I create a dataset?" ambiguity** — if no dataset exists, conversation produces memories as usual
- **The upload is the intent signal** — by uploading a spreadsheet, the user says "track this structured data"
- **Adding rows from conversation is low-risk** — columns already exist, LLM just fills them

## Example Flow

1. User drops a CSV: `devices.csv` with columns: Name, Type, IP68, CE, FDA
2. System creates dataset "Medical Devices" with that schema + 20 rows of data
3. User says: "We just got IP68 certification for the new pulse oximeter"
4. Pipeline matches conversation to "Medical Devices" dataset (entity overlap: "pulse oximeter" is a device name) → upserts row
5. User asks: "Which devices have IP68?" → query dataset → structured answer

## Storage Design

Two WatermelonDB tables (additive migration):

### `datasets` table
```
id, name, description, schema (JSON), sourceFileName,
columnCount, rowCount, createdAt, updatedAt
```

Schema JSON example:
```json
{
  "columns": [
    { "name": "Name", "type": "text", "isPrimary": true },
    { "name": "Type", "type": "text" },
    { "name": "IP68", "type": "boolean" },
    { "name": "CE", "type": "boolean" },
    { "name": "FDA", "type": "text" }
  ]
}
```

### `dataset_rows` table
```
id, datasetId, data (JSON), createdAt, updatedAt
```

Data JSON example:
```json
{
  "Name": "Pulse Oximeter X1",
  "Type": "monitoring",
  "IP68": true,
  "CE": true,
  "FDA": "pending"
}
```

## LLM Tool Interface

The extraction pipeline gets these tools when datasets exist:

- `list_datasets()` → names + column schemas (so LLM knows what's available)
- `query_dataset(datasetId, filter)` → rows matching structured or text filter
- `upsert_row(datasetId, primaryKey, data)` → insert or update a row by primary key
- `add_column(datasetId, column)` → extend schema (never delete columns)

## Matching Conversation to Dataset

Uses the same entity/topic overlap mechanism as memory retrieval:
- If conversation entities match dataset row values (device names), the dataset is relevant
- If conversation topics match dataset name/description, the dataset is relevant
- The dataset becomes another context source alongside memories

## File Format Support

Upload parsing:
- **CSV** — standard comma/tab separated
- **Excel (.xlsx)** — first sheet, header row detection
- **Markdown table** — pipe-delimited tables
- **JSON array** — array of objects with consistent keys

All formats: first row = column headers, subsequent rows = data.

## Future Considerations

- Dataset versioning (undo row changes)
- Cross-dataset queries ("devices with IP68 that are also in the EU market")
- Dataset sharing/export back to CSV
- Column type inference from data (numbers, dates, booleans)
- Computed columns or aggregations
