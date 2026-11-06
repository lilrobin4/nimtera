"""Render the English silent walkthrough from capture-intro.mjs screenshots.
Requires Pillow and imageio-ffmpeg. Run after building and capturing a local preview.
"""
from pathlib import Path
import subprocess
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

folder = Path('.arena/intro')
media = Path('public/media')
media.mkdir(exist_ok=True)
scenes = [
    ('1', 4, 'What is NimTera?', 'Your catalog, cashier and orders in one place.'),
    ('2', 4, '01 / Register your shop', 'Use your email and a strong password. Enable 2FA later if you choose.'),
    ('3', 4, '02 / Set up your catalog', 'Add products, prices and photos. Upload your shop logo in Settings.'),
    ('4', 2, '03 / Choose your menu', 'Open the shop link, or choose items on the shop/restaurant cashier screen.'),
    ('4b', 2, '03 / Choose your menu', 'Open the shop link, or choose items on the shop/restaurant cashier screen.'),
    ('5', 4, '04 / Check your payment', 'Use the stated test network. Wait for the verified order status.'),
]
font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
for key, duration, title, subtitle in scenes:
    frame = Image.new('RGB', (1920, 1080), '#0B0F14')
    draw = ImageDraw.Draw(frame)
    draw.text((48, 18), 'NimTera / QUICK GUIDE', font=ImageFont.truetype(bold, 23), fill='#DFC496')
    draw.text((1450, 18), 'VISUAL DEMO / TESTNET', font=ImageFont.truetype(bold, 23), fill='#5EEAD4')
    screenshot = Image.open(folder / f'screen-{key}.png').convert('RGB').resize((1920, 900), Image.Resampling.LANCZOS)
    frame.paste(screenshot, (0, 60))
    draw = ImageDraw.Draw(frame)
    draw.rectangle((0, 930, 1920, 1080), fill='#111820')
    draw.line((0, 930, 1920, 930), fill='#D1BA91', width=2)
    draw.text((48, 946), title, font=ImageFont.truetype(bold, 33), fill='#DFC496')
    draw.text((48, 992), subtitle, font=ImageFont.truetype(font, 30), fill='#F8FAFC')
    draw.text((48, 1040), 'nimtera.store  |  Illustrative data. Not a real payment. Silent video.', font=ImageFont.truetype(font, 20), fill='#CBD5E1')
    frame.save(folder / f'frame-{key}.png')
    if key == '1':
        frame.resize((1280, 720), Image.Resampling.LANCZOS).save(media / 'nimtera-intro-en-poster.jpg', quality=85)
args = [imageio_ffmpeg.get_ffmpeg_exe(), '-y']
for key, duration, _, _ in scenes:
    args += ['-loop', '1', '-framerate', '24', '-t', str(duration), '-i', str(folder / f'frame-{key}.png')]
filters = ''.join(f'[{i}:v]scale=1280:720,setsar=1,fade=t=in:st=0:d=0.12,fade=t=out:st={duration-.12}:d=0.12[v{i}];' for i, (_, duration, _, _) in enumerate(scenes))
filters += ''.join(f'[v{i}]' for i in range(len(scenes))) + f'concat=n={len(scenes)}:v=1:a=0[out]'
args += ['-filter_complex', filters, '-map', '[out]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(media / 'nimtera-intro-en.mp4')]
subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
vtt = 'WEBVTT\n\n'
start = 0
for key, duration, _, subtitle in scenes:
    vtt += f'00:00:{start:02d}.000 --> 00:00:{start+duration:02d}.000 line:15%\n{subtitle}\n\n'
    start += duration
(media / 'nimtera-intro-en.vtt').write_text(vtt)
assert start == 20
print('Rendered 20-second English video:', (media / 'nimtera-intro-en.mp4').stat().st_size, 'bytes')
