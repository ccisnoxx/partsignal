
import json,http.client,re,hashlib
out={}
for host,port,proto,prefix in [('127.0.0.1',19080,http.client.HTTPConnection,'loopback'),('geo.962850.xyz',443,http.client.HTTPSConnection,'public')]:
 c=proto(host,port,timeout=10);c.request('GET','/');r=c.getresponse();body=r.read();status=r.status;c.close();assert status==200
 match=re.search(rb'<script[^>]+src="(/assets/[^" ]+\.js)"',body);assert match
 asset=match.group(1).decode();c=proto(host,port,timeout=10);c.request('GET',asset);r=c.getresponse();data=r.read();astatus=r.status;c.close();assert astatus==200
 out[prefix]={'root_sha256':hashlib.sha256(body).hexdigest(),'asset_sha256':hashlib.sha256(data).hexdigest(),'asset_path':asset,'root_status':status,'asset_status':astatus}
assert out['public']==out['loopback'];print(json.dumps(out))
