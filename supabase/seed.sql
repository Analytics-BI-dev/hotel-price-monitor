-- Idempotente: alinha a referencia antes do upsert e usa o slug como chave.
update public.hotels
set is_reference_hotel = false
where is_reference_hotel = true
  and slug <> 'hotel-curi-executive';

insert into public.hotels (
  name,
  slug,
  is_reference_hotel,
  official_site_enabled,
  official_site_url,
  trivago_enabled,
  trivago_property_id,
  active
)
values
  (
    'Hotel Curi Executive',
    'hotel-curi-executive',
    true,
    true,
    'https://www.hotelcuri.com.br/',
    true,
    '2436946',
    true
  ),
  (
    'Curi Palace Hotel',
    'curi-palace-hotel',
    false,
    true,
    'https://www.curipalacehotel.com.br/',
    true,
    '1180090',
    true
  ),
  (
    'Hotel Alles Blau',
    'hotel-alles-blau',
    false,
    true,
    'https://www.hotelallesblau.com.br/#reserva',
    true,
    '7770070',
    true
  ),
  (
    'Jacques Georges Tower',
    'jacques-georges-tower',
    false,
    true,
    'https://reservas.desbravador.com.br/hotel-app/hotel-jacques-georges-tower',
    true,
    '3387958',
    true
  ),
  (
    'Hotel Jacques Georges Business',
    'jacques-georges-business',
    false,
    false,
    null,
    true,
    '3487706',
    true
  ),
  (
    'ibis Pelotas',
    'ibis-pelotas',
    false,
    true,
    'https://ibispelotas.atriohoteis.com.br/',
    true,
    '48115946',
    true
  ),
  (
    'M Tower Hotel',
    'm-tower-hotel',
    false,
    true,
    'https://www.mtowerhotel.com.br/',
    true,
    '2899803',
    true
  )
on conflict (slug) do update
set
  name = excluded.name,
  is_reference_hotel = excluded.is_reference_hotel,
  official_site_enabled = excluded.official_site_enabled,
  official_site_url = excluded.official_site_url,
  trivago_enabled = excluded.trivago_enabled,
  trivago_property_id = excluded.trivago_property_id,
  active = excluded.active,
  updated_at = now();

