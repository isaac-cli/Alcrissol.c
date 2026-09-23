const axios = require('axios');
require('dotenv').config();

const key = process.env.CHILEXPRESS_SUBSCRIPTION_KEY_COBERTURAS;

async function tryUrl(url) {
    console.log('Trying URL:', url);
    try {
        const res = await axios.get(url, {
            headers: {
                'Ocp-Apim-Subscription-Key': key,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Success! Status: ${res.status}`);
        console.log('Sample data:', JSON.stringify(res.data).substring(0, 300));
        return true;
    } catch (e) {
        console.log(`Failed! Status: ${e.response ? e.response.status : e.message}`);
        if (e.response && e.response.data) {
            console.log('Error data:', JSON.stringify(e.response.data));
        }
        return false;
    }
}

async function main() {
    const domain = process.env.CHILEXPRESS_ENV === 'production' 
        ? 'https://services.wschilexpress.com' 
        : 'https://testservices.wschilexpress.com';
    
    console.log(`📡 Usando ambiente Chilexpress: ${process.env.CHILEXPRESS_ENV || 'test'} (${domain})\n`);

    const urls = [
        `${domain}/georeference/api/v1.0/regions`,
        `${domain}/georeference/api/v1.0/coverage-areas?RegionCode=RM&type=0`
    ];
    for (const url of urls) {
        await tryUrl(url);
        console.log('--------------------------------------------------');
    }
}

main();
