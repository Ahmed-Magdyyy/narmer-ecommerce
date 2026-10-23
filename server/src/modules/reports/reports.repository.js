import { ReportOrder } from './reports.model.js';

export const reportsRepository = {
  aggregate: pipeline => ReportOrder.aggregate(pipeline).option({ maxTimeMS: 10000 }).exec(),
};
