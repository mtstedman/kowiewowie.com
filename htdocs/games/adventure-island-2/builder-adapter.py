import os, sys, stat, json, time, hashlib, signal, re, html

ROOT='/home/mason/.local/share/posse-rom-toolchain'
LIB=ROOT+'/authoring/browser-performance-libraries-20261112'
REF=ROOT+'/authoring/browser-reference-controls-20261112'
WORK=ROOT+'/work'
LIBPINS={'compiler.py':'065e65d6d93390948b8fb60c985f8457a19fbdbb4b463e776888d2e95f5e0315','browser.py':'59fbb76fb325b7809f2e76dad9915ff342300056ef3a588ffae7abf54bea9c12'}
REFPINS={'runtime.mjs':(17857,'ff8c053669ff2ef7f74ca9cb64a6360206c9c5f580843d336a67fd34dbd26487'),'machine.mjs':(18326,'16a27321594d38b5e8ff7b3a0fbd9953e48e42a0f93149835a7c0ee27c85af99'),'app.mjs':(14423,'fecc6d96aaad5e5be2dc0eebf7d7ad0f7ede99ccfda00ac25622e6f9e2c6b3cc'),'worker.mjs':(1529,'bda021bafb9af90ffed69814feeea7b8f56fbf5aff37719cace63614760b34a3'),'index.html':(3757,'28ef459de6939a238797419a866117e2b22a141e9ca060833a5bed9ad9977f86'),'styles.css':(2763,'dd5e6933af7c782ca1851e5bd2b9b30cff7c0c2e059dac011210263b1247b93f'),'gamepad.mjs':(2399,'871075585547001bc71951e6d44e1450718d6874581a2869d2cd33b8828cd007'),'touch-dpad.mjs':(2356,'cd25fed16dcd2c263477cca4261ce6ea02f99c05dae3b1f7251169e304921848')}
LIMITS={'max_ms':(1000,590000,590000),'max_file_bytes':(16,67108864,1048576),'max_candidates':(1,2000000,2000000),'max_artifact_bytes':(1048576,268435456,268435456),'max_output_bytes':(4096,20480,8192)}
SOURCES=['https://www.nesdev.org/wiki/MMC3','https://www.nesdev.org/wiki/MMC3_pinout','https://www.nesdev.org/wiki/TxROM','https://www.nesdev.org/wiki/Programming_MMC3','https://www.nesdev.org/wiki/PPU_rendering','https://www.nesdev.org/wiki/PPU_scrolling','https://www.nesdev.org/wiki/PPU_sprite_evaluation','https://www.nesdev.org/wiki/PPU_frame_timing','https://raw.githubusercontent.com/christopherpow/nes-test-roms/master/mmc3_irq_tests/readme.txt','https://raw.githubusercontent.com/SourMesen/Mesen2/master/Core/NES/Mappers/Nintendo/MMC3.h','https://raw.githubusercontent.com/bfirsh/jsnes/v2.1.0/src/mappers/mapper4.js']
LIMITATIONS=['No ROM execution, browser interaction, measured performance or full-game correctness is established by this build.','Official immutable-PRG CPU instructions only; unofficial opcodes, RAM execution and operands wrapping FFFF into RAM trap.','CPU read timing, interrupt polling and DMC arbitration retain the reference instruction-boundary approximations. Exact emitted CPU write offsets, including both RMW writes, are retained.','The new PPU fetch/render adapter is unvalidated. Sprite selection is batched at dot 257; sprite overflow timing, mid-render OAM effects, analog behavior and sub-dot PPU register delays are not modeled accurately.','Consecutive manual IRQ reloads before an intervening non-manual counter clock stop with UNSUPPORTED_MMC3_RELOAD_GLITCH. Published descriptions disagree on details across chip revisions.','MMC6, MC-ACC, mixed CHR ROM/RAM, outer banking, expansion devices, NES 2.0, PAL and non-power-of-two geometries are unsupported.','OAM/DMC overlap and active-render OAM DMA retain explicit failure boundaries. RAM is volatile; there is no battery persistence or full-machine checkpoint.','A 600-second owner timeout must be configured separately. max_ms cannot extend a shorter host timeout. Dense translations can exceed the artifact budget.','This derived format must not be passed through current romjs-browser-preview: it rejects mapper4 and replaces runtime/machine files. Site publication requires a consumer that explicitly accepts the new format.']
DEADLINE=float('inf'); C=None; B=None; OPT=None; ADAPTER=b''; TRANSFORMS=[]
class Failure(Exception):
    def __init__(self,code,message): super().__init__(message);self.code=code

def need(ok,code,message):
    if not ok: raise Failure(code,message)
def check(): need(time.monotonic()<DEADLINE,'TIME_LIMIT','Shared build deadline reached.')
def sha(b): return hashlib.sha256(b).hexdigest()
def js(v): return json.dumps(v,ensure_ascii=True,separators=(',',':'),allow_nan=False)
def enc(v): return (js(v)+'\n').encode()
def rec(b): return {'bytes':len(b),'sha256':sha(b)}
def parse(b):
    def pairs(items):
        out={}
        for k,v in items:
            need(k not in out,'BAD_JSON','Duplicate JSON field.');out[k]=v
        return out
    try:return json.loads(b,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(Failure('BAD_JSON','Nonfinite JSON.')))
    except (ValueError,UnicodeError,RecursionError):raise Failure('BAD_JSON','Malformed bounded JSON.')
def interrupted(*args): raise Failure('CANCELLED_OR_TIMEOUT','Build interrupted; no incomplete package is successful.')
def pathcheck(p):
    need(isinstance(p,str) and 1<=len(p)<=4096 and p.startswith('/') and '\x00' not in p and all(x not in ('','.','..') for x in p.split('/')[1:]),'BAD_PATH','Canonical absolute path required.');return p
def sig(s):return(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def safe_read(p,cap):
    pathcheck(p);fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        parts=p.split('/')[1:]
        for part in parts[:-1]:
            check();n=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=n
        before=os.stat(parts[-1],dir_fd=fd,follow_symlinks=False)
        need(stat.S_ISREG(before.st_mode) and 0<=before.st_size<=cap,'NOT_REGULAR_OR_LIMIT','Expected bounded regular file: '+os.path.basename(p))
        f=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
        try:
            start=os.fstat(f);need(sig(start)==sig(before),'SOURCE_CHANGED','Changed before open.');chunks=[];left=start.st_size
            while left:
                check();data=os.read(f,min(left,65536));need(bool(data),'SOURCE_CHANGED','Short input.');chunks.append(data);left-=len(data)
            need(sig(start)==sig(os.fstat(f))==sig(os.stat(parts[-1],dir_fd=fd,follow_symlinks=False)),'SOURCE_CHANGED','Changed during read.');return b''.join(chunks)
        finally:os.close(f)
    finally:os.close(fd)
def replace(s,old,new,label):
    need(s.count(old)==1,'TRANSFORM_CONTRACT','Expected unique source anchor: '+label)
    out=s.replace(old,new,1);TRANSFORMS.append({'label':label,'old_sha256':sha(old.encode()),'new_sha256':sha(new.encode())});return out
def section(s,start,end,new,label):
    need(s.count(start)==1 and s.count(end)==1,'TRANSFORM_CONTRACT','Expected unique section: '+label)
    a=s.index(start);z=s.index(end,a);return replace(s,s[a:z],new,label)
def validate(x):
    need(isinstance(x,dict) and not set(x)-{'rom_path','mmc3','display_title',*LIMITS},'BAD_INPUT','Unknown fields or non-object input.');pathcheck(x.get('rom_path'))
    out=dict(x)
    title=x.get('display_title','Translated NES game')
    need(isinstance(title,str) and 1<=len(title)<=256 and bool(title.strip()) and all(ord(c)>=32 and not 127<=ord(c)<=159 and not 0xD800<=ord(c)<=0xDFFF for c in title),'BAD_TITLE','display_title must be 1-256 plain-text characters, not blank, without controls or Unicode surrogates.')
    out['display_title']=title
    for k,(lo,hi,default) in LIMITS.items():
        v=x.get(k,default);need(type(v) is int and lo<=v<=hi,'BAD_LIMIT','Invalid '+k);out[k]=v
    q=x.get('mmc3');keys={'board','irq_revision','reload_policy','prg_ram','mirroring','m2_falling_dot','startup_model','startup_select','startup_registers','startup_mirroring','startup_ram_protect'}
    need(isinstance(q,dict) and set(q)==keys,'BAD_POLICY','All explicit MMC3 policy fields are required.')
    choices={'board':('standard-txrom',),'irq_revision':('sharp-bc','alternate'),'reload_policy':('reject-consecutive-reload',),'prg_ram':('none','8k'),'mirroring':('mapper','fixed_horizontal','fixed_vertical','four_screen'),'startup_model':('explicit-banks-zero-irq',)}
    for k,v in choices.items():need(q[k] in v,'BAD_POLICY','Unsupported '+k)
    for k,hi in [('m2_falling_dot',2),('startup_select',255),('startup_mirroring',1),('startup_ram_protect',255)]:need(type(q[k]) is int and 0<=q[k]<=hi,'BAD_POLICY','Invalid '+k)
    need(isinstance(q['startup_registers'],list) and len(q['startup_registers'])==8 and all(type(v) is int and 0<=v<=255 for v in q['startup_registers']),'BAD_POLICY','Eight startup bank bytes required.')
    out['mmc3']={k:q[k] for k in sorted(keys)};return out

def html_source(ref,title):
    s=ref.decode('utf-8');escaped=html.escape(title,quote=True)
    for tag in ('title','h1'):
        opening='<'+tag+'>';closing='</'+tag+'>'
        matches=re.findall(re.escape(opening)+r'[^<]*'+re.escape(closing),s)
        need(len(matches)==1 and s.count(opening)==1 and s.count(closing)==1,'TRANSFORM_CONTRACT','Expected one plain-text HTML '+tag+' element.')
        s=replace(s,matches[0],opening+escaped+closing,'HTML '+tag+' display_title')
    return s.encode('utf-8')

def load_libraries():
    global C,B
    sources={name:safe_read(LIB+'/'+name,262144) for name in LIBPINS}
    for name,data in sources.items():need(sha(data)==LIBPINS[name],'LIBRARY_INTEGRITY','Pinned library differs: '+name)
    identity=parse(safe_read(LIB+'/identity.json',16384))
    for stem in ('compiler','browser'):need(identity.get(stem,{}).get('sha256')==LIBPINS[stem+'.py'] and identity[stem].get('path')==LIB+'/'+stem+'.py','LIBRARY_IDENTITY','Library identity differs.')
    namespaces=[];prefixes={}
    for name,marker in [('compiler.py',b'\ncap=8192\n'),('browser.py',b'\ncap=8192;report=report_base()\n')]:
        data=sources[name];need(data.count(marker)==1,'LIBRARY_BOUNDARY','Unique CLI boundary missing.');prefix=data.split(marker)[0];ns={'__name__':'romjs_mmc3_'+name[:-3]};exec(compile(prefix,LIB+'/'+name,'exec'),ns);namespaces.append(ns);prefixes[name]=sha(prefix)
    C,B=namespaces;C['platform']();C['DEADLINE']=B['DEADLINE']=DEADLINE;C['WRITE_CAP']=OPT['max_artifact_bytes'];C['WRITTEN']=0;B['OPT']=OPT;B['C']=C;B['USED']=0;B['JOBS']=set()
    original_write=C['write_at'];original_job=C['new_job']
    def write(fd,name,data):B['reserve'](len(data.encode() if isinstance(data,str) else data));return original_write(fd,name,data)
    def job(prefix):
        out,fd=original_job(prefix);B['JOBS'].add(out);return out,fd
    C['write_at']=write;C['new_job']=job
    fd=C['directory'](WORK,True);os.close(fd)
    return sources,prefixes

def references():
    raw=safe_read(REF+'/identity.json',16384);identity=parse(raw)
    pins={k:{'bytes':v[0],'sha256':v[1]} for k,v in REFPINS.items()}
    need(identity.get('source_commit')=='a0c4ce480579a08404e9c8b861de00a869f3d122' and identity.get('files')==pins,'REFERENCE_IDENTITY','Reference identity changed.')
    files={}
    for name,pin in pins.items():
        b=safe_read(REF+'/'+name,pin['bytes']);need(rec(b)==pin,'REFERENCE_INTEGRITY','Reference differs: '+name);files[name]=b
    need(safe_read(REF+'/identity.json',16384)==raw,'REFERENCE_CHANGED','Reference identity changed.');return files,raw

def parse_rom(b,cfg):
    need(len(b)>=16 and b[:4]==b'NES\x1a','BAD_ROM','Expected iNES header.');h=b[:16]
    need(h[7]&15==0,'UNSUPPORTED_FORMAT','Only ordinary iNES console format is supported.')
    need((h[6]>>4)|(h[7]&240)==4,'UNSUPPORTED_MAPPER','Expected mapper4.')
    need(h[8]<=1 and h[9]==0 and not any(h[10:]),'UNSUPPORTED_HEADER','Only strict NTSC iNES with ordinary RAM fields is supported.')
    need(h[4] in (1,2,4,8,16,32) and h[5] in (0,1,2,4,8,16,32),'UNSUPPORTED_GEOMETRY','Power-of-two PRG 16-512 KiB and CHR ROM 8-256 KiB or 8 KiB CHR RAM required.')
    need(bool(h[6]&8)==(cfg['mirroring']=='four_screen'),'BAD_POLICY','Four-screen wiring must agree with the header.')
    need(not(cfg['prg_ram']=='none' and (h[6]&6 or h[8])),'BAD_POLICY','Trainer, battery or explicit RAM requires installed 8 KiB RAM.')
    off=16+(512 if h[6]&4 else 0);end=off+h[4]*16384
    need(len(b)==end+h[5]*8192,'ROM_LENGTH','ROM length differs from declared layout.')
    prg=b[off:end];return {'prg':prg,'chr':b[end:],'trainer':b[16:off],'banks':len(prg)//8192,'battery':bool(h[6]&2),'header_mirroring':'four_screen' if h[6]&8 else 'vertical' if h[6]&1 else 'horizontal','vectors':{k:int.from_bytes(prg[-6+i*2:-4+i*2] if i<2 else prg[-2:],'little') for i,k in enumerate(('nmi','reset','irq'))}}

BUS4=r'''
const S4=['select','r0','r1','r2','r3','r4','r5','r6','r7','mirror','protect','latch','counter','reload','reloadBlocked','enabled','asserted','clock','lastWriteCycle','ppuAddress','ppuDot','lowSamples'];
const K4=['mapper','identity',...S4,'version','w0','w1','w2','w3','ramEnabled','ramWritable'];
function windows4(v,info){const mask=info.prgBanks-1,r6=(v.r6&63)&mask,r7=(v.r7&63)&mask;return v.select&64?[info.prgBanks-2,r7,r6,info.prgBanks-1]:[r6,r7,info.prgBanks-2,info.prgBanks-1];}
function valid4(v,info){
 if(!exact(v,K4)||v.mapper!==4||v.identity!==info.mappingIdentity)bad('BAD_MAPPING','MMC3 snapshot identity/fields');
 for(const k of ['select','r0','r1','r2','r3','r4','r5','r6','r7','protect','latch','counter'])integer(v[k],255,'MMC3 byte');
 integer(v.mirror,1,'mirroring');integer(v.ppuAddress,16383,'PPU address');integer(v.lowSamples,3,'A12 filter');
 for(const k of ['reload','reloadBlocked','enabled','asserted','ramEnabled','ramWritable'])if(typeof v[k]!=='boolean')bad('BAD_MAPPING','MMC3 boolean');
 for(const k of ['clock','ppuDot','version'])integer(v[k],Number.MAX_SAFE_INTEGER-8192,'MMC3 counter');
 if(!Number.isSafeInteger(v.lastWriteCycle)||v.lastWriteCycle< -1||v.lastWriteCycle>=v.clock)bad('BAD_MAPPING','MMC3 write clock');
 if((v.ppuAddress&4096)&&v.lowSamples!==0)bad('BAD_MAPPING','High A12 cannot accumulate low samples');
 const w=windows4(v,info),enabled=info.mmc3.prg_ram==='8k'&&Boolean(v.protect&128);
 if(w.some((b,i)=>v['w'+i]!==b)||v.ramEnabled!==enabled||v.ramWritable!==(enabled&&!(v.protect&64))||v.asserted&&!v.enabled)bad('BAD_MAPPING','Inconsistent MMC3 derived state');
 return {...v};
}
export function makeBus(prg,trainer=new Uint8Array(),io={},info={mapper:4},chr=new Uint8Array()){
 const cfg=info.mmc3,n=prg?.length/8192;
 if(info.mapper!==4||!(prg instanceof Uint8Array)||![2,4,8,16,32,64].includes(n)||info.prgBanks!==n||typeof info.mappingIdentity!=='string'||!cfg)bad('BAD_ROM_DATA','MMC3 geometry/identity');
 if(!(trainer instanceof Uint8Array)||![0,512].includes(trainer.length)||!(chr instanceof Uint8Array)||![0,8192,16384,32768,65536,131072,262144].includes(chr.length))bad('BAD_ROM_DATA','MMC3 CHR/trainer');
 if(cfg.board!=='standard-txrom'||!['sharp-bc','alternate'].includes(cfg.irq_revision)||cfg.reload_policy!=='reject-consecutive-reload'||!['none','8k'].includes(cfg.prg_ram)||!['mapper','fixed_horizontal','fixed_vertical','four_screen'].includes(cfg.mirroring)||cfg.startup_model!=='explicit-banks-zero-irq')bad('BAD_ROM_DATA','Unsupported MMC3 policy');
 integer(cfg.m2_falling_dot,2,'M2 phase');byte(cfg.startup_select);byte(cfg.startup_ram_protect);integer(cfg.startup_mirroring,1,'startup mirroring');
 if(!Array.isArray(cfg.startup_registers)||cfg.startup_registers.length!==8)bad('BAD_ROM_DATA','Eight startup bank registers');cfg.startup_registers.forEach(byte);
 if(!io||typeof io!=='object'||Array.isArray(io)||Object.keys(io).some(k=>!['read','write','peek'].includes(k))||Object.values(io).some(v=>typeof v!=='function'))bad('BAD_BUS','I/O callbacks');
 const rom=prg.slice(),ram=new Uint8Array(2048),sram=new Uint8Array(cfg.prg_ram==='8k'?8192:0),chrRAM=chr.length===0,chrData=chrRAM?new Uint8Array(8192):chr.slice();
 if(trainer.length){if(!sram.length)bad('BAD_ROM_DATA','Trainer requires RAM');sram.set(trainer,4096);}
 let version=0,state={select:cfg.startup_select,mirror:cfg.startup_mirroring,protect:cfg.startup_ram_protect,latch:0,counter:0,reload:false,reloadBlocked:false,enabled:false,asserted:false,clock:0,lastWriteCycle:-1,ppuAddress:0,ppuDot:0,lowSamples:0};
 for(let i=0;i<8;i++)state['r'+i]=cfg.startup_registers[i];
 const bump=()=>{if(version>=Number.MAX_SAFE_INTEGER-8192)bad('MAPPING_OVERFLOW','Epoch exhausted');version++;};
 const ramEnabled=()=>sram.length>0&&Boolean(state.protect&128);
 function mapPRG(a){address(a);if(a<32768)bad('BAD_ARGUMENT','PRG address');const slot=(a-32768)>>>13,mask=n-1;let bank;if(slot===3)bank=n-1;else if(slot===1)bank=state.r7&63&mask;else bank=((state.select&64)?slot===0:slot===2)?n-2:state.r6&63&mask;return bank*8192+(a&8191);}
 function mapCHR(a){integer(a,8191,'CHR address');let slot=(a>>>10)^((state.select&128)?4:0),bank=slot<4?((state[slot<2?'r0':'r1']&254)+(slot&1)):state['r'+(slot-2)];return (bank&(chrData.length/1024-1))*1024+(a&1023);}
 function mirroring(){return cfg.mirroring==='mapper'?(state.mirror?'horizontal':'vertical'):cfg.mirroring.replace('fixed_','');}
 function mapNametable(a){integer(a,16383,'PPU address');if(a<8192||a>=16128)bad('BAD_ARGUMENT','Nametable address');const off=(a-8192)&4095,page=off>>>10,mode=mirroring();return (mode==='four_screen'?page:mode==='vertical'?page&1:page>>>1)*1024+(off&1023);}
 function getMapperState(){const w=windows4(state,info),en=ramEnabled();return {mapper:4,identity:info.mappingIdentity,...state,version,w0:w[0],w1:w[1],w2:w[2],w3:w[3],ramEnabled:en,ramWritable:en&&!(state.protect&64)};}
 function loadMapperState(v){const q=valid4(v,info),next={};for(const k of S4)next[k]=q[k];bump();state=next;}
 function getCPUClock(){return state.clock;}
 function advanceCPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'CPU clock');if(t<state.clock)bad('BAD_TIMING','CPU clock backwards');state.clock=t;}
 function external(a,peek){const fn=peek?io.peek:io.read;if(!fn)bad('HARDWARE_UNIMPLEMENTED','Missing open-bus/device handler');return byte(fn(a));}
 function read(a,peek=false){address(a);if(a<8192)return ram[a&2047];if(a>=32768)return rom[mapPRG(a)];if(a>=24576&&ramEnabled())return sram[a-24576];return external(a,peek);}
 function write(a,v,t){
  address(a);byte(v);integer(t,Number.MAX_SAFE_INTEGER-8192,'Absolute CPU write cycle');if(t<state.clock)bad('BAD_TIMING','CPU write precedes clock');
  if(a>=32768&&(a&57345)===49153&&state.reloadBlocked)bad('UNSUPPORTED_MMC3_RELOAD_GLITCH','Consecutive manual reload requires board-specific pathological behavior');
  bump();state.clock=t+1;state.lastWriteCycle=t;
  if(a<8192){ram[a&2047]=v;return;}
  if(a>=32768){switch(a&57345){case 32768:state.select=v;break;case 32769:state['r'+(state.select&7)]=v;break;case 40960:state.mirror=v&1;break;case 40961:state.protect=v;break;case 49152:state.latch=v;break;case 49153:state.counter=0;state.reload=true;break;case 57344:state.enabled=false;state.asserted=false;break;case 57345:state.enabled=true;break;}return;}
  if(a>=24576){if(ramEnabled()&&!(state.protect&64))sram[a-24576]=v;return;}
  if(!io.write)bad('HARDWARE_UNIMPLEMENTED','Missing device write');io.write(a,v,t);
 }
 function irqClock(){const old=state.counter,manual=state.reload;state.counter=old===0||manual?state.latch:old-1;if(state.counter===0&&state.enabled&&(cfg.irq_revision==='sharp-bc'||old>0||manual))state.asserted=true;state.reload=false;state.reloadBlocked=manual;}
 function advancePPUClock(t){integer(t,Number.MAX_SAFE_INTEGER-8192,'PPU clock');if(t<state.ppuDot)bad('BAD_TIMING','PPU clock backwards');if(t===state.ppuDot)return;const phase=cfg.m2_falling_dot;if(!(state.ppuAddress&4096)){const edges=Math.floor((t-1-phase)/3)-Math.floor((state.ppuDot-1-phase)/3);state.lowSamples=Math.min(3,state.lowSamples+edges);}state.ppuDot=t;bump();}
 function setPPUAddress(a,t=state.ppuDot){integer(a,16383,'PPU address');advancePPUClock(t);const high=Boolean(a&4096),was=Boolean(state.ppuAddress&4096);bump();if(high&&!was&&state.lowSamples>=3)irqClock();if(high||was)state.lowSamples=0;state.ppuAddress=a;}
 const api={read:a=>read(a),peek:a=>read(a,true),write,mapPRG,mapCHR,mapNametable,getMirroring:mirroring,getMapperState,loadMapperState,getCPUClock,advanceCPUClock,setPPUAddress,advancePPUClock,getPPUClock:()=>state.ppuDot,getIRQ:()=>state.asserted,peekCHR:a=>chrData[mapCHR(a)],ppuRead(a,t=state.ppuDot){integer(a,8191,'CHR address');setPPUAddress(a,t);return chrData[mapCHR(a)];},ppuWrite(a,v,t=state.ppuDot){integer(a,8191,'CHR address');byte(v);setPPUAddress(a,t);if(chrRAM)chrData[mapCHR(a)]=v;},snapshot(){return {ram:ram.slice(),prgRam:sram.slice(),chrRam:chrRAM?chrData.slice():new Uint8Array(),mapper:getMapperState()};},loadRAM(r,p){if(!(r instanceof Uint8Array)||r.length!==2048||!(p instanceof Uint8Array)||p.length!==sram.length)bad('BAD_ARGUMENT','Exact RAM arrays');bump();ram.set(r);sram.set(p);},loadCHR(r){if(!(r instanceof Uint8Array)||r.length!==(chrRAM?8192:0))bad('BAD_ARGUMENT','Exact CHR RAM');bump();if(chrRAM)chrData.set(r);}};
 if(Object.isFrozen(info)&&Object.isFrozen(cfg)&&Object.isFrozen(cfg.startup_registers))ownedBuses.set(api,{info,snapshot(){const w=windows4(state,info);return {w0:w[0],w1:w[1],w2:w[2],w3:w[3],version,clock:state.clock};},unchanged(m){return version===m.version&&state.clock===m.clock;}});
 return Object.freeze(api);
}
'''

PPU4=r'''// Derived dot fetch pipeline. No CPU emulation or runtime opcode decoding.
// JSNES supplies the authenticated device container, palettes and APU.
export function installDotPPU(nes,bus,peek,write){
 const p=nes.ppu,cpu=nes.cpu;
 let v=0,t=0,fineX=0,first=true,dot=bus.getPPUClock(),odd=false,lastClear=-1;
 let lo=0,hi=0,al=0,ah=0,nt=0,at=0,pl=0,ph=0,addr=0,fetchKind=0;
 const secondary=new Uint8Array(32),ids=new Int16Array(8);secondary.fill(255);ids.fill(-1);let found=0;
 const sprites=()=>Array.from({length:8},()=>({lo:0,hi:0,x:255,attr:255,zero:false,valid:false,address:0}));let current=sprites(),next=sprites();
 const rendering=()=>Boolean(p.f_bgVisibility||p.f_spVisibility),active=()=>rendering()&&p.scanline>=20&&p.scanline<=260;
 function counters(){p.vramAddress=v;p.vramTmpAddress=t;p.firstWrite=first;p.regFH=fineX;p.cntFV=(v>>>12)&7;p.cntV=(v>>>11)&1;p.cntH=(v>>>10)&1;p.cntVT=(v>>>5)&31;p.cntHT=v&31;p.regFV=(t>>>12)&7;p.regV=(t>>>11)&1;p.regH=(t>>>10)&1;p.regVT=(t>>>5)&31;p.regHT=t&31;}
 function xinc(){if((v&31)===31)v=(v&~31)^1024;else v++;}
 function yinc(){if((v&28672)!==28672)v+=4096;else{v&=~28672;let y=(v>>>5)&31;if(y===29){y=0;v^=2048;}else if(y===31)y=0;else y++;v=(v&~992)|(y<<5);}}
 function drive(a){addr=a&16383;bus.setPPUAddress(addr,dot);}
 function read(){return peek(addr);}
 function loadBG(){lo=(lo&65280)|pl;hi=(hi&65280)|ph;al=(al&65280)|((at&1)?255:0);ah=(ah&65280)|((at&2)?255:0);}
 function shiftBG(){lo=(lo<<1)&65535;hi=(hi<<1)&65535;al=(al<<1)&65535;ah=(ah<<1)&65535;}
 function evaluate(){
  if(p.scanline===20)return;
  secondary.fill(255);ids.fill(-1);found=0;const y=p.scanline-21,height=p.f_spriteSize?16:8;
  // Active-render OAM writes are rejected below, so this bounded scan sees stable primary OAM.
  for(let i=0;i<64;i++){const row=y-p.spriteMem[i*4];if(row<0||row>=height)continue;if(found===8){p.setStatusFlag(p.STATUS_SLSPRITECOUNT,true);break;}secondary.set(p.spriteMem.subarray(i*4,i*4+4),found*4);ids[found]=i;found++;}
  p.secondaryOAM.set(secondary);p.spritesFound=found;p.sprite0InSecondary=ids[0]===0;
 }
 function spriteAddress(slot){const i=slot*4,tile=secondary[i+1],attr=secondary[i+2],height=p.f_spriteSize?16:8;let row=((p.scanline===20?255:p.scanline-21)-secondary[i])&(height-1);if(attr&128)row=height-1-row;return p.f_spriteSize?((tile&1)<<12)|((tile&254)<<4)|((row&8)<<1)|(row&7):(p.f_spPatternTable<<12)|(tile<<4)|(row&7);}
 function color(index){return p.palTable.getEntry(peek(0x3f00+index)&(p.f_dispType?0x30:0x3f));}
 function pixel(x,y){
  const mask=0x8000>>>fineX,visibleBG=p.f_bgVisibility&&(x>=8||p.f_bgClipping),bg=visibleBG?((lo&mask?1:0)|(hi&mask?2:0)):0,ba=(al&mask?1:0)|(ah&mask?2:0);
  let sp=0,sa=0,behind=false,zero=false;
  if(p.f_spVisibility&&(x>=8||p.f_spClipping))for(let i=0;i<8;i++){const s=current[i],dx=x-s.x;if(!s.valid||dx<0||dx>7)continue;const bit=(s.attr&64)?dx:7-dx,px=((s.lo>>>bit)&1)|(((s.hi>>>bit)&1)<<1);if(px){sp=px;sa=s.attr&3;behind=Boolean(s.attr&32);zero=s.zero;break;}}
  if(bg&&sp&&zero&&x!==255){p.setStatusFlag(p.STATUS_SPRITE0HIT,true);p.hitSpr0=true;}
  let index=sp&&(!bg||!behind)?16+(sa<<2)+sp:bg?(ba<<2)+bg:0;
  if(!rendering()&&(v&0x3f00)===0x3f00){index=v&31;if((index&19)===16)index&=15;}
  p.buffer[y*256+x]=color(index);
 }
 function boundary(remaining){
  if(p.scanline===0&&p.curX===1&&p.vblankPending)p._fireVblankSet(cpu,remaining);
  if(p.scanline===20&&p.curX===1&&lastClear!==dot){lastClear=dot;p._fireVblankClear(cpu,remaining<=1);}
 }
 function tick(remaining){
  boundary(remaining);const d=p.curX,line=p.scanline,run=active();
  if(line>=21&&line<=260&&d>=1&&d<=256)pixel(d-1,line-21);
  if(run){
   if(d===257){evaluate();v=(v&~0x041f)|(t&0x041f);p.sramAddress=0;}
   if(line===20&&d>=280&&d<=304)v=(v&~0x7be0)|(t&0x7be0);
   if((d>=1&&d<=256)||(d>=321&&d<=336)){
    shiftBG();const phase=(d-1)&7;
    if(phase===0){drive(0x2000|(v&0x0fff));fetchKind=1;}
    else if(phase===1)nt=read();
    else if(phase===2){drive(0x23c0|(v&0x0c00)|((v>>>4)&0x38)|((v>>>2)&7));fetchKind=2;}
    else if(phase===3)at=(read()>>>(((v>>>4)&4)|(v&2)))&3;
    else if(phase===4){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7));fetchKind=3;}
    else if(phase===5)pl=read();
    else if(phase===6){drive((p.f_bgPatternTable<<12)|(nt<<4)|((v>>>12)&7)|8);fetchKind=4;}
    else{ph=read();loadBG();xinc();}
    if(d===256)yinc();
   }else if(d>=257&&d<=320){
    const slot=(d-257)>>>3,phase=(d-257)&7,s=next[slot],i=slot*4;
    if(phase===0){s.valid=slot<found;s.zero=ids[slot]===0;s.x=secondary[i+3];s.attr=secondary[i+2];s.address=spriteAddress(slot);drive(0x2000|(v&0x0fff));}
    else if(phase===2)drive(0x2000|(v&0x0fff));
    else if(phase===4)drive(s.address);
    else if(phase===5)s.lo=read();
    else if(phase===6)drive(s.address|8);
    else if(phase===7)s.hi=read();
   }else if(d===337||d===339){drive(0x2000|(v&0x0fff));}
   else if(d===0){const tile=peek(0x2000|(v&0x0fff));drive((p.f_bgPatternTable<<12)|(tile<<4)|((v>>>12)&7));}
  }else drive(v&16383);
  dot++;bus.advancePPUClock(dot);
  if(line===20&&d===339&&odd&&rendering()){p.curX=0;p.scanline=21;const a=current;current=next;next=a;}
  else if(++p.curX===341){p.curX=0;if(line===261){p.scanline=0;p.vblankPending=true;odd=!odd;}else{p.scanline++;if(line>=20&&line<=260){const a=current;current=next;next=a;}}}
  counters();
 }
 p.advanceDots=n=>{if(!Number.isInteger(n)||n<0||n>24576)throw Error('Invalid PPU advance');for(let i=0;i<n;i++)tick(n-i);boundary(0);};
 p.triggerRendering=()=>{};p.renderFramePartially=()=>{throw Error('Lazy rendering forbidden in dot adapter');};
 p.startFrame=()=>{};
 p.startVBlank=()=>{if(p.openBusDecayFrames>0&&--p.openBusDecayFrames===0)p.openBusLatch=0;nes.ui.writeFrame(p.buffer);p.lastRenderedScanline=-1;};
 p.cntsToAddress=()=>{p.vramAddress=v;};p.regsToAddress=()=>{p.vramTmpAddress=t;};
 p.cntsFromAddress=()=>{v=p.vramAddress&32767;counters();};p.regsFromAddress=()=>{t=p.vramTmpAddress&32767;counters();};
 p.updateControlReg1=value=>{p.f_nmiOnVblank=(value>>>7)&1;p.f_spriteSize=(value>>>5)&1;p.f_bgPatternTable=(value>>>4)&1;p.f_spPatternTable=(value>>>3)&1;p.f_addrInc=(value>>>2)&1;p.f_nTblAddress=value&3;p.regS=p.f_bgPatternTable;t=(t&~0x0c00)|((value&3)<<10);counters();p._updateNmiOutput();};
 p.updateControlReg2=value=>{p.f_color=(value>>>5)&7;p.f_spVisibility=(value>>>4)&1;p.f_bgVisibility=(value>>>3)&1;p.f_spClipping=(value>>>2)&1;p.f_bgClipping=(value>>>1)&1;p.f_dispType=value&1;p.palTable.setEmphasis(p.f_color);p.updatePalettes();if(!active())drive(v&16383);};
 p.scrollWrite=value=>{if(first){t=(t&~31)|(value>>>3);fineX=value&7;}else t=(t&~0x73e0)|((value&7)<<12)|((value&248)<<2);first=!first;counters();};
 p.writeVRAMAddress=value=>{if(first)t=(t&255)|((value&63)<<8);else{t=(t&0x7f00)|value;v=t;drive(v&16383);}first=!first;counters();};
 p.readStatusRegister=()=>{const value=(cpu.mem[0x2002]&224)|(p.openBusLatch&31);first=true;if(p.scanline===0&&p.curX===0)p.nmiSuppressed=true;p.setStatusFlag(p.STATUS_VBLANK,false);p._updateNmiOutput();p.openBusLatch=value;p.openBusDecayFrames=36;counters();return value;};
 function increment(){if(active()){xinc();yinc();}else v=(v+(p.f_addrInc?32:1))&32767;counters();drive(v&16383);}
 p.vramLoad=()=>{if(active()){const e=new Error('PPUDATA read during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}const a=v&16383;let value;drive(a);if(a<0x3f00){value=p.vramBufferedReadValue;p.vramBufferedReadValue=peek(a);}else{value=(peek(a)&(p.f_dispType?0x30:0x3f))|(p.openBusLatch&192);drive(a&0x2fff);p.vramBufferedReadValue=peek(a&0x2fff);}increment();p.openBusLatch=value;p.openBusDecayFrames=36;return value;};
 p.vramWrite=value=>{if(active()){const e=new Error('PPUDATA write during rendering is not supported');e.code='UNSUPPORTED_RENDER_VRAM';throw e;}drive(v&16383);write(v&16383,value);increment();};
 const originalOamWrite=p.sramWrite.bind(p),originalOamAddress=p.writeSRAMAddress.bind(p);
 function oamGuard(){if(active()){const e=new Error('Active-render OAM writes require dot sprite evaluation');e.code='UNSUPPORTED_RENDER_OAM';throw e;}}
 p.sramWrite=value=>{oamGuard();originalOamWrite(value);};p.writeSRAMAddress=value=>{oamGuard();originalOamAddress(value);};
 nes.mmap.clockIrqCounter=()=>{throw Error('Scanline IRQ callback forbidden: MMC3 is driven by filtered PPU A12');};nes.mmap.latchAccess=()=>{throw Error('Lazy mapper latch callback forbidden');};
 counters();
}
'''

def runtime_source(ref):
    s=ref.decode();need(s.count('function banks1(')==1 and s.count('// Only module-owned buses')==1 and s.count('const MMC_KEYS=')==1 and s.count('export function makeCPU(')==1,'TRANSFORM_CONTRACT','Runtime sections differ.')
    header=s[:s.index('function banks1(')];ownership=s[s.index('// Only module-owned buses'):s.index('const MMC_KEYS=')];cpu=s[s.index('export function makeCPU('):]
    cpu=replace(cpu,'const mmc=info.mapper===1,banked=info.mapper!==0;','const mmc=true,banked=true;','CPU timed MMC3')
    cpu=section(cpu,' function mapping(){',' // m is a private fresh snapshot,'," function mapping(){\n  if(trusted)return trusted.snapshot();\n  const v=valid4(bus.getMapperState(),info);if(bus.getCPUClock()!==v.clock)bad('BAD_MAPPING','Clock hook mismatch');return v;\n }\n",'MMC3 custom mapping validation')
    cpu=replace(cpu,'const expected=(mmc?(a<49152?m.low:m.high):(a<49152?m.bank:info.prgBanks-1))*16384+(a&16383);',"const expected=m['w'+((a-32768)>>>13)]*8192+(a&8191);",'8 KiB physical fetch checks')
    cpu=replace(cpu,'let entry=mmc?blocks[(pc<49152?0:info.prgBanks)+(pc<49152?m.low:m.high)][pc]:banked?blocks[pc<49152?m.bank:info.prgBanks][pc]:blocks[pc];',"const window=(pc-32768)>>>13;let entry=blocks[window][m['w'+window]][pc];",'four-window translated dispatch')
    cpu=replace(cpu,'if(entry&&entry.cross)entry=entry.cross[m.high];',"if(entry&&entry.cross)entry=entry.cross[m['w'+(window+1)]];",'crossing operand specialization')
    result=header+ownership+BUS4+cpu
    for anchor in ['const ownedBuses=new WeakMap();','REENTRANT_CPU','MAPPING_CHANGED','CODE_CHANGED','const actual=bus.mapPRG(a);','function vector(a)','startCycle+offset','bus.advanceCPUClock(startCycle+n)']:need(anchor in result,'STATIC_CONTRACT','Missing CPU invariant: '+anchor)
    return result

def machine_source(ref):
    s=ref.decode();s=replace(s,"import {composeBus} from './runtime.mjs';","import {composeBus} from './runtime.mjs';\nimport {installDotPPU} from './ppu-mmc3.mjs';",'dot PPU import')
    s=replace(s,'const mmc=metadata.mapper===1,ux=metadata.mapper===2,banked=metadata.mapper!==0,','const mmc=metadata.mapper===4,ux=false,banked=true,','machine timed mapper4')
    s=replace(s,'busy,nmiQueued,frameReset;','busy,nmiQueued,frameReset,tracing=false;','trace state')
    s=section(s,'  function gateSupported(){','  function audioSample(',"  function gateSupported(){}\n",'remove inapplicable SNROM gate') if '  function gateSupported(){' in s else section(s,' function gateSupported(){',' function audioSample('," function gateSupported(){}\n",'remove inapplicable SNROM gate')
    s=replace(s,'||nes.papu.dmc.irqGenerated));','||nes.papu.dmc.irqGenerated||base.getIRQ()));','level mapper IRQ composition')
    s=replace(s,'   if(mmc&&!active()){nes.ppu.cntsToAddress();base.setPPUAddress(nes.ppu.vramAddress&163383);}\n','') if False else s
    s=replace(s,'   if(mmc&&!active()){nes.ppu.cntsToAddress();base.setPPUAddress(nes.ppu.vramAddress&16383);}\n','','PPU bus owned by dot pipeline')
    s=replace(s,'const current=[base.mapCHR(0),base.mapCHR(4096)],','const current=Array.from({length:8},(_,i)=>base.mapCHR(i*1024)),','eight CHR windows')
    s=replace(s,"  if(!force&&active())bad('UNSUPPORTED_RASTER_MAPPING','CHR/CIRAM mapping changed during rendering; reset required');\n",'','direct fetch raster banking')
    s=replace(s,'for(let half=0;half<2;half++){const logical=half*4096+(a&4095);','for(let half=0;half<8;half++){const logical=half*1024+(a&1023);','CHR RAM aliases')
    s=section(s,' function installPPU(){',' function writeCPU('," function installPPU(){mappingRefresh(true);installDotPPU(nes,base,ppuPeek,ppuWrite);}\n",'install coherent fetch/render pipeline')
    s=section(s,' function writeCPU(',' function initialize(',r''' function writeCPU(a,v,t,dma=false){
  int(t,cycles,Number.MAX_SAFE_INTEGER-8192,'absolute write cycle');clockTo(t);
  const cartridge=a>=32768,before=tracing&&cartridge?base.getMapperState():null,visible=tracing&&cartridge?base.peek(a):null;
  base.write(a,v,t);facade.dataBus=v;
  if(tracing&&!dma){const w={address:a,value:v,cycle:t,deviceCycle:cycles};stepWrites.push(w);if(stepWrites.length>8)bad('DEVICE_CONTRACT','Unexpected CPU write count');lastWrites.push(w);if(lastWrites.length>32)lastWrites.shift();}
  if(cartridge){metrics.mapperWrites++;if(tracing){writes.push({address:a,value:v,visible,effective:v,cycle:t,before,after:base.getMapperState()});if(writes.length>16)writes.shift();}if(a<49152)mappingRefresh();}
 }
''','trace-free timed writes')
    s=replace(s,'![0,1,2].includes(metadata.mapper)','metadata.mapper!==4','machine mapper contract')
    s=replace(s,'bankInstructions:Array(mmc?metadata.prgBanks*2:ux?metadata.prgBanks+1:1).fill(0)','bankInstructions:Array(metadata.prgBanks*4).fill(0)','bank metrics geometry')
    s=replace(s,'function step(trace=true){\n  healthy();try{','function step(trace=true){\n  healthy();tracing=trace;try{','explicit public tracing')
    s=replace(s,'const bank=physicalPC===null?0:physicalPC>>>14,index=mmc?(pc<49152?bank:metadata.prgBanks+bank):ux?(pc<49152?bank:metadata.prgBanks):0;','const bank=physicalPC===null?0:physicalPC>>>13,index=((pc-32768)>>>13)*metadata.prgBanks+bank;','physical bank metrics')
    s=replace(s," }catch(e){busy=false;fault=e.code||'DEVICE_ERROR';throw e;}\n }"," }catch(e){busy=false;fault=e.code||'DEVICE_ERROR';throw e;}finally{tracing=false;}\n }",'trace lifecycle')
    a=s.index('export const limitations=');z=s.index('\n',a)
    s=replace(s,s[a:z],'export const limitations=Object.freeze('+js(LIMITATIONS)+');','honest machine limits')
    for anchor in ['step(false);','Object.seal(f)','composeBus(base,','nes.ppu.advanceDots(3);nes.papu.clockFrameCounter(1);','maxMs??250,1,60000','invariant();return','getRGBA(buffer)']:need(anchor in s,'STATIC_CONTRACT','Reference behavior missing: '+anchor)
    return s

DOC='''# MMC3 derived browser build

This package is romjs-nes-mmc3-browser/1, not canonical browser3. Current romjs-browser-preview is incompatible: its contract permits only mapper0/1/2 and replaces the CPU and machine. Do not run it on this package. Publication is separate.

Optional display_title defaults to Translated NES game. It is plain text (1-256 characters, not blank, without controls or Unicode surrogates), HTML-escaped into only the title and h1 text of the authenticated reference. Other HTML bytes are preserved. transformations.json records both guarded substitutions; reference_files retains the original HTML pin, while transformed_files and files record the derived HTML. Derivation occurs before bundle-inputs.json and the outer manifest are generated. The title does not select ROM policy or routing.

Serve the complete package over same-origin HTTP, with .mjs served as JavaScript, CSS as text/css, and a trailing slash directory URL or index.html. The app has no runtime network dependencies. Game Start unlocks audio and sends Start. Engine resume, pause, reset, keyboard, standard gamepad, integer 2x/4x scaling and multitouch are the authenticated generic reference behavior. Loading has immediate reset cancellation; worker frame and transport guards are 60000/120000 ms. These are cancellation limits, not performance claims.

CPU code is instruction-specialized JavaScript emitted by the authenticated local compiler's translate function. No JSNES CPU/NES orchestration, opcode interpreter, eval or dynamic JavaScript compilation is used. PRG is compiled at all immutable starts in the three selectable 8 KiB windows and the fixed final window. Instructions crossing 9FFF/BFFF have statically emitted next-bank variants; DFFF crosses into the physical last bank. Mapping, epoch and source-byte checks bracket fetch callbacks, including live vectors. Timed writes and RMW old/new writes use the unchanged compiler emission. Custom buses retain full scalar snapshot validation; only module-owned buses with immutable metadata receive the private WeakMap optimization. composeBus cannot brand unrelated buses or replace cartridge mapping hooks.

Explicit standard-txrom wiring supports power-of-two 16-512 KiB PRG, 8-256 KiB CHR ROM or 8 KiB CHR RAM, optional none/8k PRG RAM, mapper H/V or explicit fixed/four-screen mirroring. R6/R7 ignore bits6/7, R0/R1 ignore bit0, and disconnected physical address lines are masked. A001 bit7 gates reads/writes and bit6 write-protects RAM; disabled/absent RAM reads use CPU open bus. Battery storage remains volatile. No bus conflicts. Header mirroring is recorded separately from the explicit startup A000 register. 

irq_revision=sharp-bc means IRQ when the counter is zero after a qualified edge. alternate requires a previous nonzero counter or explicit reload. These are digital behavioral classes, not proof of chip identity. C000 changes the latch; C001 requests reload; E000 disables and acknowledges; E001 enables without acknowledging or changing the counter. The counter runs while IRQs are disabled. A12 must remain low for three falling M2 edges. m2_falling_dot explicitly selects CPU/PPU phase; three PPU dots are advanced for every CPU cycle, including DMA stalls. The filter sees logical PPU A12 before CHR bank inversion. Diagnostic CHR peeks never clock the IRQ.

reload_policy=reject-consecutive-reload rejects a C001 after a clock that consumed a manual reload until another counter clock occurs. Published old test notes and newer reverse-engineering descriptions disagree on the pathological sequence. No claimed analog/revision emulation is substituted. Ordinary repeated C001 writes before the requested reload clock are accepted. Startup_model explicitly chooses zero memory, zero/disabled IRQ state and low initial A12; bank/select/mirroring/protection registers are supplied. This is deterministic simulation, not a power-up guarantee.

The derived PPU uses one dot timeline for background nametable/attribute/pattern fetches, sprite and dummy fetches, rendering, scrolling and filtered IRQ edges. CHR and CIRAM data are read through current mapper windows at fetch time; no scanline IRQ callback or lazy renderer clocks MMC3. Sprite 8x16 fetches use each selected tile's table bit, including FF dummy slots. Rendering-disabled and CPU PPUADDR/PPUDATA bus changes reach the same filter. Frame counting occurs at actual VBlank after real dot advancement; audio timing and reference media pacing are unchanged.

This PPU adapter has not been validated by hardware tests or a real game during drafting. Sprite evaluation is batched at dot257 and overflow timing is approximate. Active-render OAM writes/DMA and PPUDATA accesses fail. PPUADDR and scroll register writes update the dot pipeline, but sub-dot register delay, analog effects, OAM corruption and exact NMI suppression are not certified. CPU reads retain instruction-boundary timing, and DMC uses the reference immediate fetch/four-cycle-stall approximation. No speed or full-game correctness claim follows from file generation or esbuild parsing.

API: import createMachine from machine.mjs, or createCPU/createBus/metadata/getPRG/getCHR/getTrainer from compiled.mjs. The reference machine API and bounded frame/advance methods remain. Public step records traces; frame uses the trace-free path. CPU reset preserves mapper state, RAM and device time. Power reset recreates deterministic startup. Mapper snapshot restore is not a complete machine checkpoint.

All files except manifest.json are inventoried with lengths and SHA256; the returned manifest hash authenticates that inventory. compiler-manifest.json covers the newly emitted CPU graph, including its transformed runtime. It is not an old compiler receipt applied to replaced bytes. No second independent compiler reproduction is claimed. Base library hashes, library prefix hashes, eight reference pins, actual transformed runtime/machine/PPU hashes and adapter source provenance are separate fields. The active tool owner digests observed during authoring are historical observations only. dependencies and bundle inputs are authenticated before esbuild; graph metadata describes these actual new inputs. Static build parsing does not execute translated game code.

Linux Python3.11+, Node24, esbuild0.28.2 and JSNES2.1.0 at the fixed local npm directory are required. No secrets, installation or network access. Set the host tool timeout to at least600 seconds for max_ms590000; this authoring schema cannot set that field. The build shares one monotonic deadline across generation, writes and its single bounded bundler child. File and artifact ceilings are enforced; insufficient candidates fail rather than claim a complete browser package. Failed jobs remain private beneath work. Same-account concurrent executable replacement is outside the integrity boundary.
'''

def generate_cpu(out,source,rom,cfg,runtime,provenance):
    records={};names=[];slots=[[],[],[],[]];count=0;scanned=0;variants=0;wraps=0;n=rom['banks'];prg=rom['prg'];written_estimate=0
    def put(name,data):
        if isinstance(data,str):data=data.encode()
        B['putfile'](out,name,data,records)
    for slot in range(4):
        for bank in (range(n) if slot<3 else [n-1]):
            check();name='bank-'+str(bank)+'-w'+str(slot)+'.mjs';chunks=['const B=Object.create(null);\n'];start=32768+slot*8192;end=start+8192
            for pc in range(start,end):
                if pc%128==0:check()
                offset=pc-start;op=prg[bank*8192+offset];scanned+=1
                if op not in C['OPS']:continue
                mn,mode=C['OPS'][op];size=C['SIZES'][mode]
                if pc+size>65536:wraps+=1;continue
                cross=offset+size>8192;entries={}
                for following in (range(n) if cross and slot<2 else [n-1]):
                    need(count<OPT['max_candidates'],'CANDIDATE_LIMIT','Complete immutable scan exceeds max_candidates; no complete package emitted.')
                    raw=bytes(prg[(bank if offset+i<8192 else following)*8192+((offset+i)&8191)] for i in range(size));text=C['translate'](pc,raw,mn,mode);count+=1;variants+=int(cross)
                    entries[following]=text;written_estimate+=len(text)+64
                    need(written_estimate+B['USED']<=OPT['max_artifact_bytes'],'ARTIFACT_LIMIT','Translations exceed remaining aggregate budget.')
                value='{cross:{'+','.join(str(k)+':'+v for k,v in entries.items())+'}}' if cross else next(iter(entries.values()))
                chunks.append('B['+str(pc)+']='+value+';\n')
            chunks.append('function f(e){if(e.cross){for(const x of Object.values(e.cross))f(x);Object.freeze(e.cross);}else Object.freeze(e[0]);Object.freeze(e);}for(const e of Object.values(B))f(e);export default Object.freeze(B);\n')
            data=''.join(chunks);written_estimate=0;put(name,data);slots[slot].append((bank,len(names)));names.append(name)
    identity=sha((sha(source)+'\n'+js(cfg)+'\napi3-mmc3-1').encode())
    info={'apiVersion':3,'runtimeRevision':'fetch-epoch-2','mapperExtension':'mmc3-1','runtimeOptimization':'private-owned-epochs','mapper':4,'board':'standard-txrom','prgBanks':n,'prgBankBytes':8192,'mmc3':cfg,'uxrom':None,'mmc1':None,'mappingIdentity':identity,'romSha256':sha(source),'prgSha256':sha(prg),'chrSha256':sha(rom['chr']),'trainerSha256':sha(rom['trainer']),'region':'ntsc','battery':rom['battery'],'mirroring':'four_screen' if cfg['mirroring']=='four_screen' else 'mapper_controlled','headerMirroring':rom['header_mirroring'],'vectors':rom['vectors'],'vectorPolicy':'live reads from current windows; startup vector metadata only','officialOpcodes':sorted(C['OPS']),'compiled_candidates':count,'candidate_addresses':(3*n+1)*8192,'scanned_addresses':scanned,'crossing_variants':variants,'operand_wrap_candidates_rejected':wraps,'scan_complete':True,'complete_conversion':False,'compilerProvenance':provenance}
    imports=''.join('import T'+str(i)+' from '+js('./'+name)+';\n' for i,name in enumerate(names))
    tables='Object.freeze(['+','.join('Object.freeze({'+','.join(str(bank)+':T'+str(i) for bank,i in group)+'})' for group in slots)+'])'
    wrapper="import {makeCPU,makeBus,fromHex} from './runtime.mjs';\nimport {prgHex,chrHex,trainerHex} from './cartridge.mjs';\nexport {CPUError} from './runtime.mjs';\n"+imports+'const info='+js(info)+";\nfunction freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}export const metadata=freeze(info);\nconst B="+tables+";\nexport const getPRG=()=>fromHex(prgHex),getCHR=()=>fromHex(chrHex),getTrainer=()=>fromHex(trainerHex);\nexport const createBus=(io={})=>makeBus(getPRG(),getTrainer(),io,metadata,getCHR());\nexport const createCPU=(bus=createBus())=>makeCPU(bus,B,metadata);\n"
    for name,data in {'source.nes':source,'runtime.mjs':runtime,'compiled.mjs':wrapper,'cartridge.mjs':'export const prgHex='+js(prg.hex())+';\nexport const chrHex='+js(rom['chr'].hex())+';\nexport const trainerHex='+js(rom['trainer'].hex())+';\n','API.md':DOC}.items():put(name,data)
    manifest={'format':'romjs-nes-mmc3-compile/1','compiler_api_version':3,'entry':'compiled.mjs','status':'artifacts_ready','translation_modules':names,'metadata':info,'source_bytes':len(source),'prg_bytes':len(prg),'chr_bytes':len(rom['chr']),'trainer_bytes':len(rom['trainer']),'runtime_validation':'not_executed','reproduction':'new emission by authenticated base emitter and this adapter; no independent reproduction claimed','files':dict(records)}
    put('compiler-manifest.json',enc(manifest));return records,names,info

def inventory(out,records):
    allowed=set(records);found=set();dirs=set()
    for name in allowed:
        parts=name.split('/')
        for i in range(1,len(parts)):dirs.add('/'.join(parts[:i]))
    def visit(fd,prefix):
        with os.scandir(fd) as entries:
            for item in entries:
                check();name=prefix+item.name;s=item.stat(follow_symlinks=False)
                if stat.S_ISDIR(s.st_mode):
                    need(name in dirs,'OUTPUT_INVENTORY','Unexpected output directory.');child=os.open(item.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                    try:visit(child,name+'/')
                    finally:os.close(child)
                else:
                    need(name in allowed and stat.S_ISREG(s.st_mode) and s.st_nlink==1,'OUTPUT_INVENTORY','Unexpected output member.');data=C['read_at'](fd,item.name,records[name]['bytes']);need(rec(data)==records[name],'OUTPUT_INTEGRITY','Output differs: '+name);found.add(name)
    fd=C['directory'](out,True)
    try:visit(fd,'')
    finally:os.close(fd)
    need(found==allowed,'OUTPUT_INVENTORY','Missing output file.')

def build():
    libs,prefixes=load_libraries();refs,identity=references();source=safe_read(OPT['rom_path'],OPT['max_file_bytes']);cfg=OPT['mmc3'];rom=parse_rom(source,cfg)
    runtime=runtime_source(refs['runtime.mjs']);machine=machine_source(refs['machine.mjs'])
    index_html=html_source(refs['index.html'],OPT['display_title'])
    C['RUNTIME']=runtime;C['MMC3_POLICY']=cfg
    provenance={'base_library_sha256':LIBPINS,'base_prefix_sha256':prefixes,'adapter_source_sha256':sha(ADAPTER),'runtime_sha256':sha(runtime.encode()),'reference_runtime_sha256':REFPINS['runtime.mjs'][1],'emitter':'authenticated compiler.py translate; unchanged official instruction bodies','transformed_namespace':'romjs_mmc3_compiler','independent_reproduction':False}
    out=B['job']('mmc3-build');records,names,meta=generate_cpu(out,source,rom,cfg,runtime,provenance)
    def put(name,data):B['putfile'](out,name,data,records)
    for name in ['app.mjs','worker.mjs','index.html','styles.css','gamepad.mjs','touch-dpad.mjs']:put(name,index_html if name=='index.html' else refs[name])
    put('reference-identity.json',identity);put('builder-adapter.py',ADAPTER);put('machine.mjs',machine);put('ppu-mmc3.mjs',PPU4);put('USAGE.md',DOC+'\nSources:\n'+''.join('- '+u+'\n' for u in SOURCES));put('package.json',enc({'type':'module','private':True}))
    for name,version in [('jsnes','2.1.0'),('esbuild','0.28.2')]:need(parse(B['dependency'](name+'/package.json')).get('version')==version,'DEPENDENCY_VERSION','Expected '+name+' '+version)
    B['dependency']('esbuild/lib/main.js');B['dependency']('esbuild/bin/esbuild',12000000)
    vendor=[]
    for name,digest in sorted(B['DEVICE_PINS'].items()):
        data=B['read'](B['NPM']+'/jsnes/'+name,262144,False);need(sha(data)==digest,'DEPENDENCY_INTEGRITY','Device source differs: '+name);text=data.decode()
        need(not re.search(r'\bimport\s*\(|\brequire\s*\(|\beval\s*\(|new\s+Function\b',text),'DEPENDENCY_GRAPH','Dynamic device dependency.')
        for imp in re.findall(r'''\b(?:from\s*|import\s*)['"]([^'"]+)['"]''',text):
            need(imp.startswith('.') and os.path.normpath(os.path.join(os.path.dirname(name),imp)) in B['DEVICE_PINS'],'DEPENDENCY_GRAPH','Unexpected device dependency.')
        rel='vendor/jsnes/'+name;put(rel,data);vendor.append(rel)
    put('LICENSE-JSNES.txt',B['dependency']('jsnes/LICENSE'))
    put('NOTICE.txt','JSNES 2.1.0, Copyright 2020 Ben Firshman and contributors. Apache-2.0; see LICENSE-JSNES.txt.\nVendor sources are unchanged. devices.mjs combines authenticated devices. ppu-mmc3.mjs overrides PPU behavior with a separately authored dot pipeline. No JSNES CPU interpreter is included. ROM distribution rights are not granted.\n')
    entries="export {default as PPU} from './vendor/jsnes/src/ppu/index.js';\nexport {default as PAPU} from './vendor/jsnes/src/papu/index.js';\nexport {default as Mapper0} from './vendor/jsnes/src/mappers/mapper0.js';\nexport {default as Controller} from './vendor/jsnes/src/controller.js';\n"
    runtime_files=sorted(names+['runtime.mjs','compiled.mjs','cartridge.mjs','machine.mjs','ppu-mmc3.mjs','devices.mjs','worker.mjs','app.mjs','gamepad.mjs','touch-dpad.mjs','styles.css'])
    for name,data in {'device-entry.mjs':entries,'device-files.json':enc(vendor),'runtime-files.json':enc(runtime_files),'graph.mjs':B['GRAPH'],'bundle.mjs':B['BUNDLE'],'runner.mjs':B['RUNNER'],'transformations.json':enc(TRANSFORMS)}.items():put(name,data)
    put('bundle-inputs.json',enc(dict(records)))
    result=parse(B['node'](out+'/bundle.mjs',out,out,str(OPT['max_artifact_bytes']-B['USED'])))
    need(isinstance(result,dict) and result.get('bundled') is True and result.get('cpu_interpreter_present') is False and result.get('browser_graph_parsed') is True and result.get('stylesheet_parsed') is True,'BUNDLE_PROTOCOL','Unexpected bundler response.')
    for name in ['devices.mjs','device-metafile.json','browser-metafile.json']:
        data=B['read'](out+'/'+name,OPT['max_artifact_bytes']);B['reserve'](len(data));C['WRITTEN']+=len(data);records[name]=rec(data)
    graph=parse(B['read'](out+'/browser-metafile.json',OPT['max_artifact_bytes']));need(isinstance(graph,dict) and isinstance(graph.get('inputs'),dict),'BUNDLE_PROTOCOL','Malformed esbuild graph.')
    need(set(graph['inputs'])=={'verified:'+n for n in runtime_files},'BUNDLE_GRAPH','Actual parsed graph differs from complete runtime inventory.')
    for name,item in graph['inputs'].items():
        need(item.get('bytes')==records[name[9:]]['bytes'],'BUNDLE_GRAPH','Graph byte count differs.')
        for edge in item.get('imports',[]):need(edge.get('kind')=='import-statement' and not edge.get('external') and edge.get('path') in graph['inputs'],'BUNDLE_GRAPH','Invalid browser graph edge.')
    need(safe_read(OPT['rom_path'],OPT['max_file_bytes'])==source,'SOURCE_CHANGED','Original ROM changed during build.')
    for name,digest in LIBPINS.items():need(sha(safe_read(LIB+'/'+name,262144))==digest,'LIBRARY_CHANGED','Library changed during build.')
    checks=['Authenticated both local library byte streams and unique CLI prefix boundaries','Authenticated reference identity and all eight reference byte/hash pins','Applied exact unique guarded source transformations','Emitted new source-specialized CPU bank/window graph with authenticated official opcode emitter','Authenticated fixed JSNES/esbuild dependencies','Bundled devices and parsed/resolved the complete new browser graph without executing ROM code','Verified complete output inventory and every file length/hash','Re-read original ROM and library bytes before success']
    manifest={'format':'romjs-nes-mmc3-browser/1','entry':'index.html','display_title':OPT['display_title'],'machine':'machine.mjs','runner':'runner.mjs','stylesheet':'styles.css','mapper':4,'mmc3':cfg,'compiler_api_version':3,'runtime_revision':'fetch-epoch-2','mapper_extension':'mmc3-1','rom_sha256':meta['romSha256'],'prg_sha256':meta['prgSha256'],'chr_sha256':meta['chrSha256'],'mapping_identity':meta['mappingIdentity'],'translation_modules':names,'compiler_manifest_sha256':records['compiler-manifest.json']['sha256'],'compiler_provenance':provenance,'transformed_files':{n:records[n] for n in ['runtime.mjs','machine.mjs','ppu-mmc3.mjs','index.html']},'reference_files':{n:{'bytes':v[0],'sha256':v[1]} for n,v in REFPINS.items()},'reference_identity_sha256':sha(identity),'dependencies':{'jsnes':'2.1.0','esbuild':'0.28.2','build_node':'24','device_source_pins':B['DEVICE_PINS'],'build_dependency_pins':B['DEPENDENCY_PINS']},'authoring_owner_observations':{'romjs-nes-compile':'ea3182ca9a0660e915c1d3dfb275302854e0b9acd75ada4defd212bff5334cbf','romjs-nes-browser-build':'53f0369185321041cadafaf85c1af6a656532257f923d10ef3c38077bbe6456f','romjs-browser-preview':'a47b5677dce4948a784b5fca87750c683230dd13efe2c99e03d35837256755bd','runtime_owner_digest_verified':False},'complete_conversion':False,'full_game_correctness':'not_established','hardware_validation':'not_executed','browser_interaction':'not_tested','browser_packaging':'actual_new_graph_parse_and_resolve_only','cpu_execution':'authenticated instruction-specialized translated JavaScript','cpu_interpreter_in_device_graph':False,'canonical_preview_compatible':False,'csp_target':"default-src 'self'",'sources':SOURCES,'checks':checks,'limitations':LIMITATIONS,'files':dict(records)}
    raw=enc(manifest);put('manifest.json',raw);inventory(out,records);check()
    return {'status':'built','complete_conversion':False,'full_game_correctness':'not_established','artifact':{'directory':out,'entry':out+'/index.html','machine':out+'/machine.mjs','manifest':out+'/manifest.json','manifest_sha256':sha(raw),'format':manifest['format'],'rom_sha256':sha(source),'adapter_source_sha256':sha(ADAPTER),'runtime_sha256':records['runtime.mjs']['sha256'],'machine_sha256':records['machine.mjs']['sha256'],'ppu_sha256':records['ppu-mmc3.mjs']['sha256'],'compiled_candidates':meta['compiled_candidates'],'bytes':sum(r['bytes'] for r in records.values()),'file_count':len(records),'policies':cfg},'checks':checks,'limitations':LIMITATIONS}

def main():
    global DEADLINE,OPT,ADAPTER
    cap=8192
    try:
        need(sys.platform.startswith('linux') and sys.version_info>=(3,11),'PLATFORM','Linux Python3.11+ required.')
        signal.signal(signal.SIGALRM,interrupted);signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted);signal.setitimer(signal.ITIMER_REAL,2)
        raw=sys.stdin.buffer.read(32769);need(len(raw)<=32768,'INPUT_LIMIT','Input exceeds 32768 bytes.');OPT=validate(parse(raw));cap=OPT['max_output_bytes'];DEADLINE=time.monotonic()+OPT['max_ms']/1000;signal.setitimer(signal.ITIMER_REAL,OPT['max_ms']/1000)
        ADAPTER=safe_read(os.path.abspath(__file__),262144);report=build();text=enc(report);need(len(text)<=cap,'OUTPUT_LIMIT','Receipt exceeds output limit. Complete package may remain unreported.');sys.stdout.buffer.write(text);return 0
    except Exception as error:
        signal.setitimer(signal.ITIMER_REAL,0);code=getattr(error,'code',type(error).__name__);detail={'code':str(code)[:100],'message':str(error)[:1000]}
        if hasattr(error,'process'):detail['process']=error.process
        report={'status':'error','complete_conversion':False,'full_game_correctness':'not_established','limitations':['No incomplete package is reported as successful. Partial private jobs may remain. See tool draft notes for dependencies and host timeout.'],'error':detail};text=enc(report)
        if len(text)>cap:detail.pop('process',None);text=enc(report)
        sys.stderr.write(str(code)+': '+str(error)[:500]+'\n');sys.stdout.buffer.write(text);return 1
    finally:signal.setitimer(signal.ITIMER_REAL,0)

if __name__=='__main__':sys.exit(main())
