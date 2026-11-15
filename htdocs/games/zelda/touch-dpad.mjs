// Each finger owns its directions. Sliding changes edges without releasing capture.
export class TouchDPad {
  constructor(element,{press,release}){
    this.element=element;this.press=press;this.release=release;this.pointers=new Map();
    element.addEventListener('pointerdown',e=>{
      if(e.button!==0||element.dataset.enabled!=='true')return;
      e.preventDefault();this.pointers.set(e.pointerId,new Set());
      try{element.setPointerCapture(e.pointerId);}catch{this.end(e.pointerId);return;}
      this.move(e);
    });
    element.addEventListener('pointermove',e=>{if(this.pointers.has(e.pointerId)){e.preventDefault();this.move(e);}});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,e=>this.end(e.pointerId));
    element.addEventListener('contextmenu',e=>e.preventDefault());
    for(const button of element.querySelectorAll('[data-direction]'))button.addEventListener('click',e=>{
      if(e.detail!==0||e.pointerType||element.dataset.enabled!=='true')return;
      const direction=Number(button.dataset.direction),source='touch-activation:'+direction;
      if(this.press(source,direction))this.release(source);
    });
  }
  move(e){
    const held=this.pointers.get(e.pointerId);if(!held)return;
    const r=this.element.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*2-1,y=(e.clientY-r.top)/r.height*2-1;
    const next=new Set();
    if(Math.abs(x)<=1&&Math.abs(y)<=1){
      if(x<-.28)next.add(6);if(x>.28)next.add(7);
      if(y<-.28)next.add(4);if(y>.28)next.add(5);
    }
    for(const b of held)if(!next.has(b)){held.delete(b);this.release(`d:${e.pointerId}:${b}`);}
    for(const b of next)if(!held.has(b)&&this.press(`d:${e.pointerId}:${b}`,b))held.add(b);
  }
  end(id){
    const held=this.pointers.get(id);if(!held)return;
    this.pointers.delete(id);
    for(const b of held)this.release(`d:${id}:${b}`);
    try{if(this.element.hasPointerCapture(id))this.element.releasePointerCapture(id);}catch{}
  }
  clear(){for(const id of Array.from(this.pointers.keys()))this.end(id);}
  render(enabled,isHeld){
    this.element.dataset.enabled=String(enabled);
    for(const button of this.element.querySelectorAll('[data-direction]')){
      button.disabled=!enabled;button.setAttribute('aria-pressed',String(isHeld(Number(button.dataset.direction))));
    }
  }
}
