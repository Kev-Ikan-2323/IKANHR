-- ============================================================
-- 002_holidays_seed.sql
-- Días feriados oficiales 2025–2026
-- Países: MX, AR, BR, US, JP, CO, PA
-- Campo `type` = código ISO del país
-- ============================================================

-- Limpia feriados previos del seed (si se re-corre)
DELETE FROM holidays WHERE type IN ('MX','AR','BR','US','JP','CO','PA');


-- ── MÉXICO ───────────────────────────────────────────────────
-- Fuente: Artículo 74 LFT (reforma 2022)
-- Días fijos: Año Nuevo, Trabajo, Independencia, Navidad
-- Días con lunes: Constitución (1er lunes feb), Juárez (3er lunes mar), Revolución (3er lunes nov)

INSERT INTO holidays (date, name, type, year, is_recurring, status) VALUES
  -- 2025
  ('2025-01-01', 'Año Nuevo',                                   'MX', 2025, FALSE, 'activo'),
  ('2025-02-03', 'Día de la Constitución',                      'MX', 2025, FALSE, 'activo'),  -- 1er lunes feb
  ('2025-03-17', 'Natalicio de Benito Juárez',                  'MX', 2025, FALSE, 'activo'),  -- 3er lunes mar
  ('2025-05-01', 'Día del Trabajo',                             'MX', 2025, FALSE, 'activo'),
  ('2025-09-16', 'Día de la Independencia',                     'MX', 2025, FALSE, 'activo'),
  ('2025-11-17', 'Revolución Mexicana',                         'MX', 2025, FALSE, 'activo'),  -- 3er lunes nov
  ('2025-12-25', 'Navidad',                                     'MX', 2025, FALSE, 'activo'),
  -- 2026
  ('2026-01-01', 'Año Nuevo',                                   'MX', 2026, FALSE, 'activo'),
  ('2026-02-02', 'Día de la Constitución',                      'MX', 2026, FALSE, 'activo'),  -- 1er lunes feb
  ('2026-03-16', 'Natalicio de Benito Juárez',                  'MX', 2026, FALSE, 'activo'),  -- 3er lunes mar
  ('2026-05-01', 'Día del Trabajo',                             'MX', 2026, FALSE, 'activo'),
  ('2026-09-16', 'Día de la Independencia',                     'MX', 2026, FALSE, 'activo'),
  ('2026-11-16', 'Revolución Mexicana',                         'MX', 2026, FALSE, 'activo'),  -- 3er lunes nov
  ('2026-12-25', 'Navidad',                                     'MX', 2026, FALSE, 'activo');


-- ── ARGENTINA ────────────────────────────────────────────────
-- Fuente: Ley 27.399 y decretos anuales del Poder Ejecutivo Nacional
-- Pascua 2025 = 20 abr | Pascua 2026 = 5 abr

INSERT INTO holidays (date, name, type, year, is_recurring, status) VALUES
  -- 2025
  ('2025-01-01', 'Año Nuevo',                                   'AR', 2025, FALSE, 'activo'),
  ('2025-03-03', 'Carnaval',                                    'AR', 2025, FALSE, 'activo'),  -- lunes
  ('2025-03-04', 'Carnaval',                                    'AR', 2025, FALSE, 'activo'),  -- martes
  ('2025-03-24', 'Día Nac. de la Memoria por la Verdad y Justicia', 'AR', 2025, FALSE, 'activo'),
  ('2025-04-02', 'Día del Veterano y Caídos en Malvinas',       'AR', 2025, FALSE, 'activo'),
  ('2025-04-17', 'Jueves Santo',                                'AR', 2025, FALSE, 'activo'),
  ('2025-04-18', 'Viernes Santo',                               'AR', 2025, FALSE, 'activo'),
  ('2025-05-01', 'Día del Trabajador',                          'AR', 2025, FALSE, 'activo'),
  ('2025-05-25', 'Día de la Revolución de Mayo',                'AR', 2025, FALSE, 'activo'),
  ('2025-06-20', 'Paso a la Inmortalidad del Gral. Belgrano',   'AR', 2025, FALSE, 'activo'),
  ('2025-07-09', 'Día de la Independencia',                     'AR', 2025, FALSE, 'activo'),
  ('2025-08-18', 'Paso a la Inmortalidad del Gral. San Martín', 'AR', 2025, FALSE, 'activo'),  -- 3er lunes ago
  ('2025-10-13', 'Día del Respeto a la Diversidad Cultural',    'AR', 2025, FALSE, 'activo'),  -- 2do lunes oct
  ('2025-11-24', 'Día de la Soberanía Nacional',                'AR', 2025, FALSE, 'activo'),  -- 4to lunes nov
  ('2025-12-08', 'Inmaculada Concepción de María',              'AR', 2025, FALSE, 'activo'),
  ('2025-12-25', 'Navidad',                                     'AR', 2025, FALSE, 'activo'),
  -- 2026
  ('2026-01-01', 'Año Nuevo',                                   'AR', 2026, FALSE, 'activo'),
  ('2026-02-16', 'Carnaval',                                    'AR', 2026, FALSE, 'activo'),  -- lunes
  ('2026-02-17', 'Carnaval',                                    'AR', 2026, FALSE, 'activo'),  -- martes
  ('2026-03-24', 'Día Nac. de la Memoria por la Verdad y Justicia', 'AR', 2026, FALSE, 'activo'),
  ('2026-04-02', 'Día del Veterano y Caídos en Malvinas / Jueves Santo', 'AR', 2026, FALSE, 'activo'),
  ('2026-04-03', 'Viernes Santo',                               'AR', 2026, FALSE, 'activo'),
  ('2026-05-01', 'Día del Trabajador',                          'AR', 2026, FALSE, 'activo'),
  ('2026-05-25', 'Día de la Revolución de Mayo',                'AR', 2026, FALSE, 'activo'),
  ('2026-06-20', 'Paso a la Inmortalidad del Gral. Belgrano',   'AR', 2026, FALSE, 'activo'),
  ('2026-07-09', 'Día de la Independencia',                     'AR', 2026, FALSE, 'activo'),
  ('2026-08-17', 'Paso a la Inmortalidad del Gral. San Martín', 'AR', 2026, FALSE, 'activo'),  -- 3er lunes ago
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural',    'AR', 2026, FALSE, 'activo'),  -- 2do lunes oct
  ('2026-11-23', 'Día de la Soberanía Nacional',                'AR', 2026, FALSE, 'activo'),  -- 4to lunes nov
  ('2026-12-08', 'Inmaculada Concepción de María',              'AR', 2026, FALSE, 'activo'),
  ('2026-12-25', 'Navidad',                                     'AR', 2026, FALSE, 'activo');


-- ── BRASIL ───────────────────────────────────────────────────
-- Fuente: Lei 9.093/1995 y Lei 14.759/2023 (Consciência Negra nacional)
-- Pascua 2025 = 20 abr | Pascua 2026 = 5 abr

INSERT INTO holidays (date, name, type, year, is_recurring, status) VALUES
  -- 2025
  ('2025-01-01', 'Confraternização Universal (Ano Novo)',        'BR', 2025, FALSE, 'activo'),
  ('2025-03-03', 'Carnaval',                                    'BR', 2025, FALSE, 'activo'),
  ('2025-03-04', 'Carnaval',                                    'BR', 2025, FALSE, 'activo'),
  ('2025-04-18', 'Paixão de Cristo (Sexta-feira Santa)',        'BR', 2025, FALSE, 'activo'),  -- Pascua - 2
  ('2025-04-21', 'Tiradentes',                                  'BR', 2025, FALSE, 'activo'),
  ('2025-05-01', 'Dia do Trabalho',                             'BR', 2025, FALSE, 'activo'),
  ('2025-06-19', 'Corpus Christi',                              'BR', 2025, FALSE, 'activo'),  -- Pascua + 60
  ('2025-09-07', 'Independência do Brasil',                     'BR', 2025, FALSE, 'activo'),
  ('2025-10-12', 'Nossa Senhora Aparecida',                     'BR', 2025, FALSE, 'activo'),
  ('2025-11-02', 'Finados',                                     'BR', 2025, FALSE, 'activo'),
  ('2025-11-15', 'Proclamação da República',                    'BR', 2025, FALSE, 'activo'),
  ('2025-11-20', 'Consciência Negra',                           'BR', 2025, FALSE, 'activo'),
  ('2025-12-25', 'Natal',                                       'BR', 2025, FALSE, 'activo'),
  -- 2026
  ('2026-01-01', 'Confraternização Universal (Ano Novo)',        'BR', 2026, FALSE, 'activo'),
  ('2026-02-16', 'Carnaval',                                    'BR', 2026, FALSE, 'activo'),
  ('2026-02-17', 'Carnaval',                                    'BR', 2026, FALSE, 'activo'),
  ('2026-04-03', 'Paixão de Cristo (Sexta-feira Santa)',        'BR', 2026, FALSE, 'activo'),  -- Pascua - 2
  ('2026-04-21', 'Tiradentes',                                  'BR', 2026, FALSE, 'activo'),
  ('2026-05-01', 'Dia do Trabalho',                             'BR', 2026, FALSE, 'activo'),
  ('2026-06-04', 'Corpus Christi',                              'BR', 2026, FALSE, 'activo'),  -- Pascua + 60
  ('2026-09-07', 'Independência do Brasil',                     'BR', 2026, FALSE, 'activo'),
  ('2026-10-12', 'Nossa Senhora Aparecida',                     'BR', 2026, FALSE, 'activo'),
  ('2026-11-02', 'Finados',                                     'BR', 2026, FALSE, 'activo'),
  ('2026-11-15', 'Proclamação da República',                    'BR', 2026, FALSE, 'activo'),
  ('2026-11-20', 'Consciência Negra',                           'BR', 2026, FALSE, 'activo'),
  ('2026-12-25', 'Natal',                                       'BR', 2026, FALSE, 'activo');


-- ── ESTADOS UNIDOS ───────────────────────────────────────────
-- Fuente: 5 U.S.C. § 6103 — Federal holidays

INSERT INTO holidays (date, name, type, year, is_recurring, status) VALUES
  -- 2025
  ('2025-01-01', 'New Year''s Day',                             'US', 2025, FALSE, 'activo'),
  ('2025-01-20', 'Martin Luther King Jr. Day',                  'US', 2025, FALSE, 'activo'),  -- 3er lunes ene
  ('2025-02-17', 'Presidents'' Day (Washington''s Birthday)',   'US', 2025, FALSE, 'activo'),  -- 3er lunes feb
  ('2025-05-26', 'Memorial Day',                                'US', 2025, FALSE, 'activo'),  -- último lunes may
  ('2025-06-19', 'Juneteenth National Independence Day',        'US', 2025, FALSE, 'activo'),
  ('2025-07-04', 'Independence Day',                            'US', 2025, FALSE, 'activo'),
  ('2025-09-01', 'Labor Day',                                   'US', 2025, FALSE, 'activo'),  -- 1er lunes sep
  ('2025-10-13', 'Columbus Day',                                'US', 2025, FALSE, 'activo'),  -- 2do lunes oct
  ('2025-11-11', 'Veterans Day',                                'US', 2025, FALSE, 'activo'),
  ('2025-11-27', 'Thanksgiving Day',                            'US', 2025, FALSE, 'activo'),  -- 4to jueves nov
  ('2025-12-25', 'Christmas Day',                               'US', 2025, FALSE, 'activo'),
  -- 2026
  ('2026-01-01', 'New Year''s Day',                             'US', 2026, FALSE, 'activo'),
  ('2026-01-19', 'Martin Luther King Jr. Day',                  'US', 2026, FALSE, 'activo'),  -- 3er lunes ene
  ('2026-02-16', 'Presidents'' Day (Washington''s Birthday)',   'US', 2026, FALSE, 'activo'),  -- 3er lunes feb
  ('2026-05-25', 'Memorial Day',                                'US', 2026, FALSE, 'activo'),  -- último lunes may
  ('2026-06-19', 'Juneteenth National Independence Day',        'US', 2026, FALSE, 'activo'),
  ('2026-07-04', 'Independence Day',                            'US', 2026, FALSE, 'activo'),
  ('2026-09-07', 'Labor Day',                                   'US', 2026, FALSE, 'activo'),  -- 1er lunes sep
  ('2026-10-12', 'Columbus Day',                                'US', 2026, FALSE, 'activo'),  -- 2do lunes oct
  ('2026-11-11', 'Veterans Day',                                'US', 2026, FALSE, 'activo'),
  ('2026-11-26', 'Thanksgiving Day',                            'US', 2026, FALSE, 'activo'),  -- 4to jueves nov
  ('2026-12-25', 'Christmas Day',                               'US', 2026, FALSE, 'activo');


-- ── JAPÓN ────────────────────────────────────────────────────
-- Fuente: 国民の祝日に関する法律 (Ley de Días Festivos Nacionales)
-- Se incluyen 振替休日 (días sustitutos) cuando el feriado cae en domingo.
-- Equinoccio vernal: 2025 = 20 mar | 2026 = 20 mar
-- Equinoccio otoñal: 2025 = 23 sep | 2026 = 23 sep

INSERT INTO holidays (date, name, type, year, is_recurring, status) VALUES
  -- 2025
  ('2025-01-01', '元日 (Año Nuevo)',                            'JP', 2025, FALSE, 'activo'),
  ('2025-01-13', '成人の日 (Día de la Mayoría de Edad)',        'JP', 2025, FALSE, 'activo'),  -- 2do lunes ene
  ('2025-02-11', '建国記念の日 (Día de la Fundación Nacional)', 'JP', 2025, FALSE, 'activo'),
  ('2025-02-23', '天皇誕生日 (Cumpleaños del Emperador)',       'JP', 2025, FALSE, 'activo'),
  ('2025-02-24', '振替休日 (sustituto por 天皇誕生日)',         'JP', 2025, FALSE, 'activo'),  -- Feb 23 cae domingo
  ('2025-03-20', '春分の日 (Equinoccio de Primavera)',          'JP', 2025, FALSE, 'activo'),
  ('2025-04-29', '昭和の日 (Día de Showa)',                     'JP', 2025, FALSE, 'activo'),
  ('2025-05-03', '憲法記念日 (Día de la Constitución)',         'JP', 2025, FALSE, 'activo'),
  ('2025-05-04', 'みどりの日 (Día de la Naturaleza)',           'JP', 2025, FALSE, 'activo'),
  ('2025-05-05', 'こどもの日 (Día del Niño)',                   'JP', 2025, FALSE, 'activo'),
  ('2025-05-06', '振替休日 (sustituto por みどりの日)',          'JP', 2025, FALSE, 'activo'),  -- May 4 cae domingo
  ('2025-07-21', '海の日 (Día del Mar)',                        'JP', 2025, FALSE, 'activo'),  -- 3er lunes jul
  ('2025-08-11', '山の日 (Día de la Montaña)',                  'JP', 2025, FALSE, 'activo'),
  ('2025-09-15', '敬老の日 (Día de los Ancianos)',              'JP', 2025, FALSE, 'activo'),  -- 3er lunes sep
  ('2025-09-23', '秋分の日 (Equinoccio de Otoño)',              'JP', 2025, FALSE, 'activo'),
  ('2025-10-13', 'スポーツの日 (Día del Deporte)',              'JP', 2025, FALSE, 'activo'),  -- 2do lunes oct
  ('2025-11-03', '文化の日 (Día de la Cultura)',                'JP', 2025, FALSE, 'activo'),
  ('2025-11-23', '勤労感謝の日 (Día de Acción de Gracias al Trabajo)', 'JP', 2025, FALSE, 'activo'),
  ('2025-11-24', '振替休日 (sustituto por 勤労感謝の日)',        'JP', 2025, FALSE, 'activo'),  -- Nov 23 cae domingo
  -- 2026
  ('2026-01-01', '元日 (Año Nuevo)',                            'JP', 2026, FALSE, 'activo'),
  ('2026-01-12', '成人の日 (Día de la Mayoría de Edad)',        'JP', 2026, FALSE, 'activo'),  -- 2do lunes ene
  ('2026-02-11', '建国記念の日 (Día de la Fundación Nacional)', 'JP', 2026, FALSE, 'activo'),
  ('2026-02-23', '天皇誕生日 (Cumpleaños del Emperador)',       'JP', 2026, FALSE, 'activo'),
  ('2026-03-20', '春分の日 (Equinoccio de Primavera)',          'JP', 2026, FALSE, 'activo'),
  ('2026-04-29', '昭和の日 (Día de Showa)',                     'JP', 2026, FALSE, 'activo'),
  ('2026-05-03', '憲法記念日 (Día de la Constitución)',         'JP', 2026, FALSE, 'activo'),
  ('2026-05-04', 'みどりの日 (Día de la Naturaleza)',           'JP', 2026, FALSE, 'activo'),
  ('2026-05-05', 'こどもの日 (Día del Niño)',                   'JP', 2026, FALSE, 'activo'),
  ('2026-05-06', '振替休日 (sustituto por 憲法記念日)',          'JP', 2026, FALSE, 'activo'),  -- May 3 cae domingo
  ('2026-07-20', '海の日 (Día del Mar)',                        'JP', 2026, FALSE, 'activo'),  -- 3er lunes jul
  ('2026-08-11', '山の日 (Día de la Montaña)',                  'JP', 2026, FALSE, 'activo'),
  ('2026-09-21', '敬老の日 (Día de los Ancianos)',              'JP', 2026, FALSE, 'activo'),  -- 3er lunes sep
  ('2026-09-22', '国民の休日 (Día entre feriados)',             'JP', 2026, FALSE, 'activo'),  -- entre 敬老の日 y 秋分の日
  ('2026-09-23', '秋分の日 (Equinoccio de Otoño)',              'JP', 2026, FALSE, 'activo'),
  ('2026-10-12', 'スポーツの日 (Día del Deporte)',              'JP', 2026, FALSE, 'activo'),  -- 2do lunes oct
  ('2026-11-03', '文化の日 (Día de la Cultura)',                'JP', 2026, FALSE, 'activo'),
  ('2026-11-23', '勤労感謝の日 (Día de Acción de Gracias al Trabajo)', 'JP', 2026, FALSE, 'activo');


-- ── COLOMBIA ─────────────────────────────────────────────────
-- Fuente: Ley 51/1983 (Ley Emiliani) + Ley 27/1980
-- Fijos: Ene 1, May 1, Jul 20, Ago 7, Dic 8, Dic 25
-- Emiliani (se mueven al lunes siguiente si no caen en lunes):
--   Ene 6, Mar 19, Jun 29, Ago 15, Oct 12, Nov 1, Nov 11
-- Pascua 2025 = 20 abr | Pascua 2026 = 5 abr

INSERT INTO holidays (date, name, type, year, is_recurring, status) VALUES
  -- 2025
  ('2025-01-01', 'Año Nuevo',                                   'CO', 2025, FALSE, 'activo'),
  ('2025-01-06', 'Epifanía (Reyes Magos)',                      'CO', 2025, FALSE, 'activo'),  -- Ene 6 = lunes
  ('2025-03-24', 'San José',                                    'CO', 2025, FALSE, 'activo'),  -- Mar 19 = mié → lunes Mar 24
  ('2025-04-17', 'Jueves Santo',                                'CO', 2025, FALSE, 'activo'),
  ('2025-04-18', 'Viernes Santo',                               'CO', 2025, FALSE, 'activo'),
  ('2025-05-01', 'Día del Trabajo',                             'CO', 2025, FALSE, 'activo'),
  ('2025-06-02', 'Ascensión del Señor',                         'CO', 2025, FALSE, 'activo'),  -- Pascua+39=May 29 jue → lunes Jun 2
  ('2025-06-23', 'Corpus Christi',                              'CO', 2025, FALSE, 'activo'),  -- Pascua+60=Jun 19 jue → lunes Jun 23
  ('2025-06-30', 'Sagrado Corazón / San Pedro y San Pablo',     'CO', 2025, FALSE, 'activo'),  -- ambos → lunes Jun 30
  ('2025-07-20', 'Día de la Independencia',                     'CO', 2025, FALSE, 'activo'),
  ('2025-08-07', 'Batalla de Boyacá',                           'CO', 2025, FALSE, 'activo'),
  ('2025-08-18', 'Asunción de la Virgen',                       'CO', 2025, FALSE, 'activo'),  -- Ago 15 = vie → lunes Ago 18
  ('2025-10-13', 'Día de la Raza',                              'CO', 2025, FALSE, 'activo'),  -- Oct 12 = dom → lunes Oct 13
  ('2025-11-03', 'Todos los Santos',                            'CO', 2025, FALSE, 'activo'),  -- Nov 1 = sáb → lunes Nov 3
  ('2025-11-17', 'Independencia de Cartagena',                  'CO', 2025, FALSE, 'activo'),  -- Nov 11 = mar → lunes Nov 17
  ('2025-12-08', 'Inmaculada Concepción',                       'CO', 2025, FALSE, 'activo'),
  ('2025-12-25', 'Navidad',                                     'CO', 2025, FALSE, 'activo'),
  -- 2026
  ('2026-01-01', 'Año Nuevo',                                   'CO', 2026, FALSE, 'activo'),
  ('2026-01-12', 'Epifanía (Reyes Magos)',                      'CO', 2026, FALSE, 'activo'),  -- Ene 6 = mar → lunes Ene 12
  ('2026-03-23', 'San José',                                    'CO', 2026, FALSE, 'activo'),  -- Mar 19 = jue → lunes Mar 23
  ('2026-04-02', 'Jueves Santo',                                'CO', 2026, FALSE, 'activo'),
  ('2026-04-03', 'Viernes Santo',                               'CO', 2026, FALSE, 'activo'),
  ('2026-05-01', 'Día del Trabajo',                             'CO', 2026, FALSE, 'activo'),
  ('2026-05-18', 'Ascensión del Señor',                         'CO', 2026, FALSE, 'activo'),  -- Pascua+39=May 14 jue → lunes May 18
  ('2026-06-08', 'Corpus Christi',                              'CO', 2026, FALSE, 'activo'),  -- Pascua+60=Jun 4 jue → lunes Jun 8
  ('2026-06-15', 'Sagrado Corazón de Jesús',                   'CO', 2026, FALSE, 'activo'),  -- Pascua+68=Jun 12 vie → lunes Jun 15
  ('2026-06-29', 'San Pedro y San Pablo',                       'CO', 2026, FALSE, 'activo'),  -- Jun 29 = lunes ✓
  ('2026-07-20', 'Día de la Independencia',                     'CO', 2026, FALSE, 'activo'),
  ('2026-08-07', 'Batalla de Boyacá',                           'CO', 2026, FALSE, 'activo'),
  ('2026-08-17', 'Asunción de la Virgen',                       'CO', 2026, FALSE, 'activo'),  -- Ago 15 = sáb → lunes Ago 17
  ('2026-10-12', 'Día de la Raza',                              'CO', 2026, FALSE, 'activo'),  -- Oct 12 = lunes ✓
  ('2026-11-02', 'Todos los Santos',                            'CO', 2026, FALSE, 'activo'),  -- Nov 1 = dom → lunes Nov 2
  ('2026-11-16', 'Independencia de Cartagena',                  'CO', 2026, FALSE, 'activo'),  -- Nov 11 = mié → lunes Nov 16
  ('2026-12-08', 'Inmaculada Concepción',                       'CO', 2026, FALSE, 'activo'),
  ('2026-12-25', 'Navidad',                                     'CO', 2026, FALSE, 'activo');


-- ── PANAMÁ ───────────────────────────────────────────────────
-- Fuente: Ley 67/1941 y Decreto Ejecutivo 46/2006
-- Pascua 2025 = 20 abr | Pascua 2026 = 5 abr

INSERT INTO holidays (date, name, type, year, is_recurring, status) VALUES
  -- 2025
  ('2025-01-01', 'Año Nuevo',                                   'PA', 2025, FALSE, 'activo'),
  ('2025-01-09', 'Día de los Mártires',                         'PA', 2025, FALSE, 'activo'),
  ('2025-03-03', 'Carnaval',                                    'PA', 2025, FALSE, 'activo'),  -- lunes antes del Miércoles de Ceniza
  ('2025-03-04', 'Carnaval',                                    'PA', 2025, FALSE, 'activo'),  -- martes
  ('2025-04-18', 'Viernes Santo',                               'PA', 2025, FALSE, 'activo'),
  ('2025-05-01', 'Día del Trabajador',                          'PA', 2025, FALSE, 'activo'),
  ('2025-11-03', 'Separación de Panamá de Colombia',            'PA', 2025, FALSE, 'activo'),
  ('2025-11-04', 'Día de la Bandera',                           'PA', 2025, FALSE, 'activo'),
  ('2025-11-05', 'Día de Colón',                                'PA', 2025, FALSE, 'activo'),
  ('2025-11-10', 'Primer Grito de Independencia (Los Santos)',  'PA', 2025, FALSE, 'activo'),
  ('2025-11-28', 'Independencia de España',                     'PA', 2025, FALSE, 'activo'),
  ('2025-12-08', 'Día de la Madre / Inmaculada Concepción',     'PA', 2025, FALSE, 'activo'),
  ('2025-12-25', 'Navidad',                                     'PA', 2025, FALSE, 'activo'),
  -- 2026
  ('2026-01-01', 'Año Nuevo',                                   'PA', 2026, FALSE, 'activo'),
  ('2026-01-09', 'Día de los Mártires',                         'PA', 2026, FALSE, 'activo'),
  ('2026-02-16', 'Carnaval',                                    'PA', 2026, FALSE, 'activo'),
  ('2026-02-17', 'Carnaval',                                    'PA', 2026, FALSE, 'activo'),
  ('2026-04-03', 'Viernes Santo',                               'PA', 2026, FALSE, 'activo'),
  ('2026-05-01', 'Día del Trabajador',                          'PA', 2026, FALSE, 'activo'),
  ('2026-11-03', 'Separación de Panamá de Colombia',            'PA', 2026, FALSE, 'activo'),
  ('2026-11-04', 'Día de la Bandera',                           'PA', 2026, FALSE, 'activo'),
  ('2026-11-05', 'Día de Colón',                                'PA', 2026, FALSE, 'activo'),
  ('2026-11-10', 'Primer Grito de Independencia (Los Santos)',  'PA', 2026, FALSE, 'activo'),
  ('2026-11-28', 'Independencia de España',                     'PA', 2026, FALSE, 'activo'),
  ('2026-12-08', 'Día de la Madre / Inmaculada Concepción',     'PA', 2026, FALSE, 'activo'),
  ('2026-12-25', 'Navidad',                                     'PA', 2026, FALSE, 'activo');
