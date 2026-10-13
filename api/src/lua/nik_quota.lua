-- M2: cek + tambah kuota NIK dalam SATU operasi atomik (tanpa race condition).
-- KEYS[1] = nik:{event}:{hmac(nik)}
-- ARGV[1] = jumlah tiket yang ingin ditambahkan
-- ARGV[2] = batas maksimum (2)
-- ARGV[3] = TTL detik (0 = tanpa TTL)
-- Return: kuota baru, atau -1 jika melebihi batas.
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local add = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
if cur + add > max then
  return -1
end
local new = redis.call('INCRBY', KEYS[1], add)
if tonumber(ARGV[3]) > 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[3])
end
return new
