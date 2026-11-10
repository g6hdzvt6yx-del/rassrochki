# Локальная проверка миграции 006

Копия схемы облака «rassrochki» (после 005; поверх неё ставятся 007–009) и вымышленные данные — без единой записи реальных клиентов.
Схема собрана из каталога PostgreSQL облака (функции, политики, права, триггеры) 04.11.2026.

```sh
export PGHOST=localhost PGPORT=5432 PGUSER=postgres   # любой локальный PostgreSQL 15+
createdb eppaz_check
for f in 00_supabase_stub.sql 01_cloud_schema_copy.sql ../../007_operator_marks.sql ../../008_expenses.sql \
         ../../009_expense_period.sql 02_seed_fake.sql ../../006_security_followup.sql; do
  psql -v ON_ERROR_STOP=1 -d eppaz_check -f $f
done
pip install "psycopg[binary]"
python3 test_006.py eppaz_check        # ожидается: 29 из 29
```

Без последнего файла (`006_security_followup.sql`) те же проверки показывают, что было до миграции.
Каждая проверка идёт в транзакции с откатом — базу можно гонять повторно.
