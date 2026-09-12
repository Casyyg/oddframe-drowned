export type Choice={choiceId:string;label:string;nextSceneId:string};
export type Session={sceneId:string;scene:{title:string;video:string;poster:string;duration:number;choices:Choice[];ending:string|null};listen:boolean;talk:boolean;door:string;phone:string;complete:boolean;ending:string|null;version:number;token?:string};
export async function api<T = Session>(path:string,token?:string,body?:unknown):Promise<T>{
  const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json() as T & {error?:string};if(!response.ok)throw new Error(data.error??'The request failed. Please retry.');return data;
}
