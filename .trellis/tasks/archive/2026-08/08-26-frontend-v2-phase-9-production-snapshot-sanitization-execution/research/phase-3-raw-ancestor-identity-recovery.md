# raw ancestor identity recovery evidence

authoritative historical host output只证明 existing raw ancestor=`/root/partsignal-data`、owner=`0:0`、directory/non-symlink=`true/true`、filesystem type=`ext4`、filesystem label=`empty`，并在该次观察时记录 available bytes=`46994563072`。它没有输出或证明 Docker volume name=`partsignal_data`。

因此 fresh host preflight 的唯一身份合同是 path/owner/directory/non-symlink/filesystem type/label；available bytes 必须按新窗口动态读取并只验证十进制 shape与容量阈值。禁止查询、推断或要求不存在的 Docker volume name。

该历史诊断还观察到 raw parent=`/root/partsignal-data/snapshot-quarantine` 与当时 run directory均不存在，并明确 `database_connected=false`、`resource_mutation=false`。这些历史 absence/capacity 不能替代 fresh run 的同窗口核验。
