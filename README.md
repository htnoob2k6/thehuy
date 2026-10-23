# Podcast / Media Library

Website quản lý thư viện podcast và audio, viết bằng Node.js/Express, lưu dữ liệu trong MySQL; có phpMyAdmin, Nginx HTTPS, Prometheus, Grafana, Loki và Promtail.

## Chức năng

- Xem danh mục và danh sách tập, tìm kiếm theo tiêu đề/mô tả/người dẫn, lọc theo danh mục.
- Nghe thử tệp MP3, WAV, OGG, M4A, AAC hoặc FLAC (tối đa 30 MB).
- Tạo, sửa, xóa tập podcast và danh mục qua mục **Quản trị** trên website.
- MySQL tạo schema và một số danh mục mẫu khi khởi động lần đầu.
- Biểu đồ Grafana có sẵn cho request/độ trễ ứng dụng, CPU/RAM container và trạng thái MySQL.
- Log Docker được thu thập về Loki; dùng LogQL trong Grafana Explore.

## Yêu cầu

- Docker Desktop với Docker Compose v2.
- Git.

## Khởi chạy trên Windows

Mở PowerShell tại thư mục dự án:

```powershell
Copy-Item .env.example .env
```

Tạo các chuỗi bí mật riêng biệt bằng bộ sinh ngẫu nhiên mật mã có sẵn trong Windows PowerShell:

```powershell
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
'MYSQL_ROOT_PASSWORD','MYSQL_PASSWORD','MYSQL_EXPORTER_PASSWORD','ADMIN_API_KEY','GRAFANA_ADMIN_PASSWORD' | ForEach-Object {
  $bytes = New-Object byte[] 36
  $rng.GetBytes($bytes)
  "$_=$(([Convert]::ToBase64String($bytes)).Replace('+','A').Replace('/','B').TrimEnd('='))"
}
$rng.Dispose()
```

Chép các giá trị vừa tạo vào những trường tương ứng trong `.env`; khóa `ADMIN_API_KEY` cần ít nhất 32 ký tự. Không commit `.env`.

```powershell
docker compose up --build -d
docker compose ps
```

Lần đầu cần tải các image và khởi tạo MySQL; quá trình build Nginx sinh chứng chỉ tự ký cho `localhost`.

| Dịch vụ | Địa chỉ |
| --- | --- |
| Website | https://localhost:8443 |
| HTTP chuyển hướng HTTPS (chỉ localhost) | http://localhost:18080 → https://localhost:8443 |
| phpMyAdmin (chỉ bind localhost) | http://localhost:8082 |
| Grafana (chỉ bind localhost) | http://localhost:3000 |

Trình duyệt sẽ cảnh báo vì HTTPS dùng chứng chỉ tự ký. Tài khoản Grafana lấy từ `GRAFANA_ADMIN_USER` và `GRAFANA_ADMIN_PASSWORD` trong `.env`. Đăng nhập phpMyAdmin bằng `MYSQL_USER` / `MYSQL_PASSWORD` (hoặc root khi cần quản trị).
Nếu đổi `APP_PORT`, cập nhật cổng đích HTTPS `8443` trong lệnh redirect ở `nginx/default.conf` cho khớp.

Trong **Quản trị**, nhập `ADMIN_API_KEY` trong `.env`. Khóa chỉ được giữ trong `sessionStorage` của tab hiện tại. Chọn **Tập podcast** để tải audio, sửa hoặc xóa tập; chọn **Danh mục** để thêm/xóa danh mục. Không thể xóa danh mục vẫn đang được sử dụng.

Kiểm tra ứng dụng:

```powershell
curl.exe --insecure https://localhost:8443/healthz
docker compose logs --tail 100 app
```

## Prometheus, Grafana và Loki

- Prometheus scrape ứng dụng (`/metrics` nội bộ), Nginx exporter, MySQL exporter, cAdvisor và Node exporter mỗi 15 giây.
- Grafana tự cấu hình Prometheus và Loki làm data source; dashboard **Podcast platform** được provision sẵn.
- Promtail phát hiện log container qua Docker socket và đẩy vào Loki. Trong Grafana → **Explore** → Loki, thử LogQL:

```logql
{project="podcast-library"}
{project="podcast-library", service="app"} |= "failed"
{project="podcast-library", service="nginx"} |~ " 4[0-9][0-9] "
```

Tên `project` thay đổi theo `COMPOSE_PROJECT_NAME` trong `.env`. Có thể kiểm tra trạng thái scrape tại `http://localhost:9090/targets` nếu chạy Prometheus không qua proxy; mặc định Prometheus không publish cổng ra host. Grafana panel hiển thị metric sau khi Prometheus hoàn thành scrape đầu tiên.

## Hardening đã áp dụng

- App, Nginx và Prometheus/Grafana/Loki chạy non-root theo image/container; app và Nginx dùng filesystem read-only, bỏ Linux capabilities và bật `no-new-privileges`.
- Chỉ Nginx publish cổng website; MySQL chỉ nằm trên backend network `internal`. phpMyAdmin và Grafana chỉ bind `127.0.0.1`.
- Network tách cho proxy, dữ liệu, quản trị cục bộ và monitoring; exporter dùng tài khoản MySQL riêng với quyền chỉ đọc cần thiết.
- Mật khẩu/khóa cấu hình qua `.env` không commit; API quản trị bắt buộc API key và so sánh constant-time.
- Nginx dùng HTTPS TLS 1.2/1.3, tự ký cho môi trường học tập, security headers, giới hạn kích thước upload và ẩn phiên bản.
- API dùng prepared statements, xác thực/giới hạn dữ liệu đầu vào; giới hạn audio 30 MB và phần mở rộng/MIME được cho phép.

> Trên Docker Desktop, cAdvisor/Node exporter có thể chỉ phản ánh một phần host Linux VM; đây là giới hạn của môi trường Windows container hóa. Không nên public phpMyAdmin/Grafana trực tiếp ra Internet. Khi triển khai máy chủ thật, thay chứng chỉ tự ký bằng chứng chỉ tin cậy, bảo vệ `.env`, cấu hình firewall và TLS phù hợp.

## Kiểm thử

```powershell
Push-Location app
npm test
Pop-Location
docker compose config
```

## Git và các mốc commit

Repo local được khởi tạo ngay trong thư mục project. Ba commit được tách theo yêu cầu đề:

1. `feat: deploy podcast library behind hardened nginx` — app, MySQL/phpMyAdmin, reverse proxy HTTPS và hardening.
2. `feat: add prometheus and grafana monitoring` — exporters, Prometheus, Grafana và dashboard.
3. `feat: centralize container logs with loki and promtail` — Loki, Promtail, truy vấn LogQL và hướng dẫn.

Để đưa repo lên GitHub, tạo/đăng nhập tài khoản GitHub với username theo mã số sinh viên (nếu chưa có, đăng ký tài khoản trực tiếp trên GitHub). Tạo repository, ví dụ `podcast-media-library-<ma-sv>`, rồi thêm remote và push:

```powershell
git remote add origin https://github.com/<github-user>/<repository>.git
git push -u origin main
```

Không chia sẻ token/ mật khẩu GitHub hoặc commit chúng vào repository.
