"""Assemble actual browser screenshots, NOT a continuous screen recording.
Requires ffmpeg and Noto Sans CJK; no app pixels or results are fabricated.
"""
from pathlib import Path
import subprocess,json,hashlib
root=Path(__file__).resolve().parent
frames=[
('01-landing.png','01  本地对账工作台','实际操作截图演示，不是连续录屏'),
('08-sample-overview.png','02  合成月度案例队列','221 条调查案例，不是 221 次错误或已核实收入'),
('02-import-validated.png','03  显式导入范围与校验','只使用合成 CSV；没有连接 ServiceTitan、QuickBooks 或银行账户'),
('03-fee-case.png','04  费用差异与来源证据','核实身份关系，而不是仅凭金额相等自动入账'),
('04-draft.png','05  经过人工复核的费用草案','借：手续费 900；贷：清算账户 900；不重复借记银行'),
('05-after-export.png','06  文件导出与重复保护','下载不是入账；未进行 QuickBooks 导入；重复保护有本地存储边界'),
('10-ambiguous.png','07  歧义必须保留','证据不足时不自动确认；不能据此宣称客户可用或盈利'),
]
font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
cmd=['ffmpeg','-hide_banner','-loglevel','error','-y']
for name,_,_ in frames:cmd+=['-loop','1','-t','7','-i',str(root/name)]
filters=[]
for i,(_,title,sub) in enumerate(frames):
 filters.append(f'[{i}:v]scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:1080:(ow-iw)/2:110:color=0x132c25,setsar=1,drawtext=fontfile={font}:text={title}:fontsize=31:fontcolor=white:x=32:y=16,drawtext=fontfile={font}:text={sub}:fontsize=22:fontcolor=0xcde2d9:x=32:y=64,drawtext=fontfile={font}:text=SYNTHETIC ONLY / DO NOT IMPORT - Actual screenshots - Not continuous recording:fontsize=19:fontcolor=0xffd28a:x=32:y=1038[v{i}]')
filters.append(''.join(f'[v{i}]' for i in range(len(frames)))+f'concat=n={len(frames)}:v=1:a=0[v]')
cmd+=['-filter_complex',';'.join(filters),'-map','[v]','-r','15','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart',str(root/'synthetic-demo-slideshow.mp4')]
subprocess.run(cmd,check=True)
(root/'slideshow-provenance.json').write_text(json.dumps({'kind':'actual screenshot slideshow, not continuous recording','durationSeconds':49,'frames':[{'file':f,'title':t,'caption':s,'sha256':hashlib.sha256((root/f).read_bytes()).hexdigest()}for f,t,s in frames]},ensure_ascii=False,indent=2))
