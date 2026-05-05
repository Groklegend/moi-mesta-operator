-- Миграция №13: добавление колонки email в applications.
-- В шаге «Контакты и каналы» формы подключения компании теперь
-- обязательное поле «E-mail». Колонка nullable, чтобы не падали
-- ранее созданные черновики, в которых поле было пустым.

alter table public.applications
  add column if not exists email text;
