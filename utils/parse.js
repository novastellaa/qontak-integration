export function parseIccidAndOrderId(message) {
    const iccidRegex = /\b\d{18,20}\b/;
    const orderIdRegex = /\b\d{5,}\b/;

    const iccidMatch = message.match(iccidRegex);
    const orderIdMatch = message.match(orderIdRegex);

    return {
        iccid: iccidMatch ? iccidMatch[0] : null,
        orderId: orderIdMatch ? orderIdMatch[0] : null
    };
}