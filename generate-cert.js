const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

async function generate() {
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = await selfsigned.generate(attrs, { days: 365 });

    const dir = path.join(__dirname, 'secrets');
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir);
    }

    fs.writeFileSync(path.join(dir, 'key.pem'), pems.private);
    fs.writeFileSync(path.join(dir, 'cert.pem'), pems.cert);

    console.log('✅ 已在 ./secrets 目录下生成自签名证书！');
}

generate().catch(err => console.error(err));
