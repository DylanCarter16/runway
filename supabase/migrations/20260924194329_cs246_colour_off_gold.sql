-- Phase 9, part C: UW gold is the accent now, so CS 246's amber course colour (too close to
-- gold) becomes Math pink. Only rows still on the seeded amber change; a colour picked by hand stays.
update public.courses
set color = '#B0266E', color_dark = '#F27AB4'
where code = 'CS 246' and color = '#B7791F' and color_dark = '#E3B25A';
