// Posse extracted reusable engine factory; original body retained.
export function instantiate(imports){
"use strict";

const translationLimits=Object.freeze({"cache_entries":4096,"compilations":65536,"source_bytes":16777216});

return Object.freeze(Object.defineProperties(Object.create(null),{"translationLimits":{enumerable:true,get:()=>translationLimits}}));
}
