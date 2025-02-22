const { transformData } = require('../utils/pvuvTransform');
const influxService = require('../services/influxService');

class PvuvController {
    async updatePvUv(ctx) {
        try {
            const FlowDataParams = ctx.request.body;
            const { pagePath, os, browser, deviceType } = FlowDataParams
            const timestamp = new Date().toISOString();
            const addCount = ctx.request.body.addCount || 1;
            // console.log('收到的参数:', ctx.request.body); // 输出收到的参数
            // console.log('pagePath', pagePath)
            if (!pagePath) {
                ctx.status = 400;
                ctx.body = { error: '缺少必须参数pagePath！' };
                return;
            }
            const point = transformData({
                timestamp,
                pagePath,
                addCount,
                os, browser, deviceType
            }, ctx.state);
            console.log('写入的数据点:', point); // 输出写入的数据点
            await influxService.writePoints([point]);

            ctx.status = 201;
            ctx.body = { success: true };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: '更新流量数据失败' };
            console.error('更新流量失败:', err);
        }
    }

    //可以根据
    async getPvUv(ctx) {
        try {
            const { pagePath, dataType, os = 'Windows', device_type = 'Desktop', browser = 'Chrome', ip = '::1' } = ctx.query;
            const rangeTime = ctx.query.rangeTime || 7;
            if (!pagePath || !dataType || !['pv', 'uv'].includes(dataType)) {
                ctx.status = 400;
                ctx.body = { error: '参数错误！必须提供pagePath和有效的dataType。' };
                return;
            }
            //前端传入开始时间和结束时间
            let startRange = null;
            let endRange = null;
            if (ctx.query.startTime && ctx.query.endTime) {
                startRange = new Date(ctx.query.startTime);
                endRange = new Date(ctx.query.endTime);
                
                // 检查时间是否有效
                if (isNaN(startRange.getTime()) || isNaN(endRange.getTime())) {
                    ctx.status = 400;
                    ctx.body = { error: '开始时间或结束时间格式不正确！' };
                    return;
                }
                // 检查开始时间是否早于结束时间
                if (startRange >= endRange) {
                    ctx.status = 400;
                    ctx.body = { error: '开始时间必须早于结束时间！' };
                    return;
                }
            } else {
                // 如果没有传入开始时间和结束时间，使用默认的 rangeTime
                if (isNaN(rangeTime) || rangeTime <= 0) {
                    ctx.status = 400;
                    ctx.body = { error: 'rangeTime参数必须是正整数！' };
                    return;
                }
                startRange = `-${rangeTime}d`;
            }


            // 构造基础过滤条件
            let filterConditions = `r._measurement == "flowData" `;
            if (pagePath !== 'total') {
                filterConditions += ` and r.pagePath == "${pagePath}"`;
            }

            // 添加可选项的过滤条件
            filterConditions += ` and r.os == "${os}"`;
            filterConditions += ` and r.device_type == "${device_type}"`;
            filterConditions += ` and r.browser == "${browser}"`;
            filterConditions += ` and r.ip == "${ip}"`;

            // 根据dataType构建查询语句
            let query;
            let data
            let totalCount
            if (dataType === 'pv') {
                //若有指定开始时间和结束时间
                if (typeof startRange === 'string') {
                    query = `
                        from(bucket: "monitor data")
                            |> range(start: ${startRange})
                            |> filter(fn: (r) => ${filterConditions})
                            |> sum(column: "_value")
                    `;
                } else {
                    query = `
                        from(bucket: "monitor data")
                            |> range(start: ${startRange.toISOString()}, stop: ${endRange.toISOString()})
                            |> filter(fn: (r) => ${filterConditions})
                            |> sum(column: "_value")
                    `;
                }
                data = await influxService.queryData(query);
                totalCount = data.reduce((acc, curr) => acc + (curr._value || 0), 0);
            } else { // uv处理
                if (typeof startRange === 'string') {
                    query = `
                        from(bucket: "monitor data")
                            |> range(start: ${startRange})
                            |> filter(fn: (r) => ${filterConditions})
                            // 按照时间排序，确保最早的记录排在前面
                            |> sort(columns: ["_time"], desc: false)
                            // 取每个分组的第一条记录
                            |> first()
                            // 去重 IP 地址
                            |> distinct(column: "ip")
                            |> count()
                    `;
                } else {
                    query = `
                        from(bucket: "monitor data")
                            |> range(start: ${startRange.toISOString()}, stop: ${endRange.toISOString()})
                            |> filter(fn: (r) => ${filterConditions})
                            // 按照时间排序，确保最早的记录排在前面
                            |> sort(columns: ["_time"], desc: false)
                            // 取每个分组的第一条记录
                            |> first()
                            // 去重 IP 地址
                            |> distinct(column: "ip")
                            |> count()
                    `;
                }
                data = await influxService.queryData(query);
                totalCount = data.length > 0 ? data[0]._value : 0;
            }
            // console.log('查询到的pvuvssssssss数据:', data); // 输出查询到的数据      
            ctx.body = { success: true, totalCount };
        } catch (err) {
            ctx.status = 500;
            ctx.body = { error: '查询流量数据失败' };
            console.error('查询流量数据错误:', err);
        }
    }
}

module.exports = new PvuvController();