// Standard Gamepad API mapping covers Windows XInput/Xbox controllers.
// Feed edges into the same sampled input queue as keyboard and touch controls.
export class GamepadInput {
  constructor({press,release,status,read=()=>navigator.getGamepads?.()??[]}){
    this.press=press;this.release=release;this.status=status;this.read=read;
    this.index=null;this.previous=Array(8).fill(false);this.stick=Array(4).fill(false);
    this.blocked=false;this.message='';
  }
  show(message){if(message!==this.message){this.message=message;this.status(message);}}
  releaseAll(){
    if(this.index!==null)for(let b=0;b<8;b++)if(this.previous[b])this.release(`g:${this.index}:${b}`);
    this.previous.fill(false);this.stick.fill(false);
  }
  clear(){this.releaseAll();this.blocked=true;}
  poll(enabled){
    let devices;
    try{devices=Array.from(this.read()).filter(p=>p?.connected);}
    catch{this.releaseAll();this.show('Controller access unavailable in this browser. Keyboard and touch still work.');return;}
    const pads=devices.filter(p=>p.mapping==='standard');
    const pad=pads.find(p=>p.index===this.index)??pads[0];
    if(!pad){
      this.releaseAll();this.index=null;this.blocked=false;
      this.show(devices.length?'Controller detected without a standard mapping. Use XInput mode.':'Controller: connect an Xbox/XInput pad and press a button to detect it.');return;
    }
    if(pad.index!==this.index){this.releaseAll();this.index=pad.index;}
    this.show('Controller connected · D-pad / left stick: move · A: jump · X or B: shoot · Menu: Start · View: Select');
    const button=n=>Boolean(pad.buttons[n]?.pressed||pad.buttons[n]?.value>.5);
    const x=Number.isFinite(pad.axes[0])?pad.axes[0]:0,y=Number.isFinite(pad.axes[1])?pad.axes[1]:0;
    const values=[-y,y,-x,x];
    for(let i=0;i<4;i++)this.stick[i]=values[i]>(this.stick[i] ? .30 : .45);
    const next=[button(0),button(1)||button(2),button(8),button(9),
      button(12)||this.stick[0],button(13)||this.stick[1],button(14)||this.stick[2],button(15)||this.stick[3]];
    if(!enabled){this.releaseAll();this.blocked=true;return;}
    if(this.blocked){if(!next.some(Boolean))this.blocked=false;return;}
    for(let b=0;b<8;b++){
      if(next[b]===this.previous[b])continue;
      if(next[b])this.press(`g:${this.index}:${b}`,b);else this.release(`g:${this.index}:${b}`);
      this.previous[b]=next[b];
    }
  }
}
