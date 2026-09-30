const TZ="America/Sao_Paulo";
const MIN_SPACING_MS=90*60*1000;
const READY_TTL_MS=24*60*60*1000;

function parts(value){
  const d=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(d.getTime()))return null;
  const p=new Intl.DateTimeFormat("en-CA",{
    timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(d);
  const get=type=>p.find(x=>x.type===type)?.value||"";
  return {
    day:get("year")+"-"+get("month")+"-"+get("day"),
    hour:Number(get("hour")),
    minute:Number(get("minute"))
  };
}

export function saoPauloDay(value=new Date()){
  return parts(value)?.day||"";
}

export function sameSaoPauloDay(a,b){
  const left=saoPauloDay(a),right=saoPauloDay(b);
  return Boolean(left&&right&&left===right);
}

export function isPublishingWindow(value=new Date()){
  const p=parts(value);
  if(!p)return false;
  const minutes=p.hour*60+p.minute;
  return minutes>=8*60&&minutes<=22*60;
}

export function publishingGate({now=new Date(),publishedToday=0,lastPublishedAt=null,minSpacingMs=MIN_SPACING_MS}={}){
  const current=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(current.getTime()))return {ok:false,reason:"invalid_time"};
  if(!isPublishingWindow(current))return {ok:false,reason:"outside_publishing_window"};
  const lastMs=lastPublishedAt?Date.parse(String(lastPublishedAt)):NaN;
  if(Number.isFinite(lastMs)&&current.getTime()-lastMs<Number(minSpacingMs)){
    return {ok:false,reason:"minimum_spacing_not_reached"};
  }
  return {ok:true,reason:""};
}

export function shouldExpireDraft(row,now=new Date(),ttlMs=READY_TTL_MS){
  const status=String(row?.status||"");
  if(!["ready","scheduled","failed"].includes(status))return false;
  const current=now instanceof Date?now:new Date(now);
  const created=Date.parse(String(row?.created_at||""));
  const scheduled=Date.parse(String(row?.scheduled_for||""));
  if(!Number.isFinite(current.getTime())||!Number.isFinite(created))return false;
  if(Number.isFinite(scheduled)&&scheduled>current.getTime())return false;
  return current.getTime()-created>Number(ttlMs);
}

export const PUBLISHING_POLICY=Object.freeze({
  timezone:TZ,
  earliest:"08:00",
  latest:"22:00",
  minSpacingMinutes:90,
  readyTtlHours:24
});
