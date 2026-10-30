# Sample /drone1/detections for DUR s; project each box bottom-centre to the ground (pose + camera) and
# match to the spawned targets (PX4 local N/E). Prints per-target hit counts (messages containing it) + false positives.
import roslibpy, time, json, math, sys
DUR=float(sys.argv[1]); TAG=sys.argv[2]; GROUND=float(sys.argv[3]) if len(sys.argv)>3 else 1.0  # pose alt of the ground at home
T={"person by hatchback":("person",[(-15.6,-6.0),(-16.5,-5.0)],4.0),
   "hatchback":("car",[(-17.3,-10.0)],5.0),
   "SUV":("car",[(-34.6,-20.0)],6.0),
   "far people":("person",[(-33.0,-15.0),(-33.5,-16.5)],4.5)}
CARS={"car","truck","bus"}
ros=roslibpy.Ros(host="localhost",port=9090); ros.run(timeout=8)
got=[]; t=roslibpy.Topic(ros,"/drone1/detections","std_msgs/String"); t.subscribe(lambda m: got.append(json.loads(m["data"])))
time.sleep(DUR); ros.terminate()
def ground(o,g):
    c,p=g["camera"],g.get("pose")
    if not p: return None
    W,H=c["width"],c["height"]; f=(W/2)/math.tan(math.radians(c["hfov_deg"])/2)
    b=o["box"]; x=((b[0]+b[2])/2*W-W/2)/f; y=(b[3]*H-H/2)/f
    pt=math.radians(c["pitch_deg"]); fwd=math.cos(pt)-y*math.sin(pt); dn=math.sin(pt)+y*math.cos(pt)
    h=p["alt"]-GROUND
    if dn<=1e-3: return None
    s=h/dn; F,R=s*fwd,s*x; hd=math.radians(p["heading_deg"])
    return p["north"]+F*math.cos(hd)-R*math.sin(hd), p["east"]+F*math.sin(hd)+R*math.cos(hd)
hits={k:0 for k in T}; fp=0; fpl=[]; nfp_msgs=0
for g in got:
    seen=set(); bad=0
    for o in g["objects"]:
        ne=ground(o,g); cls="car" if o["label"] in CARS else o["label"]; m=None
        if ne:
            for k,(tc,pts,r) in T.items():
                if tc==cls and any(math.hypot(ne[0]-a,ne[1]-b)<=r for a,b in pts): m=k; break
        if m: seen.add(m)
        else: bad+=1; fpl.append((o["label"],o["score"],None if not ne else (round(ne[0],1),round(ne[1],1))))
    for k in seen: hits[k]+=1
    fp+=bad; nfp_msgs+=bad>0
n=len(got); last=got[-1] if got else {}
print(f"[{TAG}] {n} msgs, fps {last.get('fps')}, infer_ms {last.get('infer_ms')}, model {last.get('model')}, alt {last.get('pose',{}).get('alt')}")
for k,v in hits.items(): print(f"   {k:20s} {v}/{n}")
print(f"   false positives: {fp} boxes in {nfp_msgs}/{n} msgs; e.g. {fpl[:4]}")
