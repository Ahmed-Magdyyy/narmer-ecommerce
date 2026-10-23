import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createSizechartsService } from '../src/modules/sizecharts/sizecharts.service.js';
import { sizechartsRepository } from '../src/modules/sizecharts/sizecharts.repository.js';
import { SizeChart, SizeChartAudit } from '../src/modules/sizecharts/sizecharts.model.js';
import { Product } from '../src/modules/products/products.model.js';
import { productsRepository } from '../src/modules/products/products.repository.js';
import { runTransaction } from '../src/shared/utils/transaction.js';
import { chartInput, measurementInput } from './helpers/sizecharts.js';
import { simpleInput, variantInput } from './helpers/products.js';

test('real MongoDB persists editable charts, batches actual assignment counts, preserves legacy images and rolls back failed table edits',
  { skip: !process.env.NARMER_TEST_MONGODB_URI }, async t => {
    const dbName = `narmer_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    await mongoose.connect(process.env.NARMER_TEST_MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000, bufferCommands: false });
    t.after(async () => {
      try {
        assert.equal(mongoose.connection.name, dbName); assert.match(dbName, /^narmer_test_[a-f0-9]{24}$/);
        for (const row of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.dropCollection(row.name);
        assert.equal((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length, 0);
      } finally { await mongoose.disconnect(); }
    });
    await Promise.all([sizechartsRepository.initialize(), Product.init()]);
    const actor = { _id: new mongoose.Types.ObjectId() }, categoryId = String(new mongoose.Types.ObjectId());
    const guard = mongoose.connection.collection('size_chart_test_guard'); await guard.insertOne({ _id: 'b2c', version: 0 });
    const categories = { async lockForCatalog(store, session) { await guard.updateOne({ _id: store }, { $inc: { version: 1 } }, { session }); } };
    const products = {
      async countSizeChartAssignments(store, ids, { session }) { return new Map((await productsRepository.countSizeChartAssignments(store, ids, session)).map(row => [String(row._id), row.count])); },
      hasSizeChartReferences: productsRepository.hasSizeChartReferences,
    };
    const charts = createSizechartsService({ auth: { async authorizeStaff() { return actor; } }, categories, products, media: {} });
    const first = await charts.create('b2c', actor, { ...chartInput, measurements: measurementInput, isActive: true });
    const second = await charts.create('b2c', actor, { ...chartInput, measurements: measurementInput, isActive: true });
    assert.equal((await charts.getStaff('b2c', actor, first.id)).measurements.rows[0].chest, 50.25);
    assert.equal((await SizeChart.findById(first.id).lean()).measurements.rows[0].size, 'S');
    const [a, b, c] = await Product.create([
      { ...simpleInput(categoryId, 'a'), store: 'b2c', sizeChartId: first.id },
      { ...variantInput(categoryId, 'b'), store: 'b2c', sizeChartId: first.id, isActive: false },
      { ...simpleInput(categoryId, 'c'), store: 'b2c', sizeChartId: second.id },
    ]);
    assert.equal((await charts.getStaff('b2c', actor, first.id)).assignedProductCount, 2);
    const page = await charts.list('b2c', actor, { limit: 1 });
    assert.equal(page.pagination.total, 2); assert.equal(page.items[0].assignedProductCount, page.items[0].id === first.id ? 2 : 1);
    const reassign = (productId, chartId) => runTransaction(async session => {
      await categories.lockForCatalog('b2c', session); await Product.updateOne({ _id: productId }, { $set: { sizeChartId: chartId }, $inc: { version: 1 } }, { session });
    });
    await reassign(b._id, second.id);
    assert.equal((await charts.getStaff('b2c', actor, second.id)).assignedProductCount, 2);
    assert.equal((await charts.getStaff('b2c', actor, second.id)).version, 0);
    await assert.rejects(charts.remove('b2c', actor, second.id), { code: 'SIZE_CHART_IN_USE' });
    const before = await SizeChart.findById(first.id).lean(), auditCount = await SizeChartAudit.countDocuments();
    const failing = createSizechartsService({ auth: { async authorizeStaff() { return actor; } }, categories, products, media: {},
      repository: { ...sizechartsRepository, async audit() { throw new Error('synthetic audit failure'); } } });
    await assert.rejects(failing.update('b2c', actor, first.id, { version: 0, measurements: null, isActive: false }), /synthetic audit failure/);
    assert.deepEqual(await SizeChart.findById(first.id).lean(), before); assert.equal(await SizeChartAudit.countDocuments(), auditCount);
    const conflict = await Promise.allSettled([1, 2].map(value => charts.update('b2c', actor, first.id, {
      version: 0, measurements: { unit: 'cm', rows: [{ size: String(value), chest: value, length: 0.29, sleeve: 1000 }] },
    })));
    assert.equal(conflict.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(conflict.find(row => row.status === 'rejected').reason.code, 'SIZE_CHART_CONFLICT');
    const publicGuide = (await charts.publicForProducts('b2c', [first.id], 'ar')).get(first.id);
    assert.equal(publicGuide.image, null); assert.equal(publicGuide.measurements.rows[0].length, 0.29);
    await charts.update('b2c', actor, first.id, { version: 1, measurements: null, isActive: false });
    assert.equal((await charts.publicForProducts('b2c', [first.id], 'en')).size, 0);
    const legacyId = new mongoose.Types.ObjectId(), image = { id: String(new mongoose.Types.ObjectId()), url: 'https://assets.example.test/legacy.webp', width: 400, height: 500 };
    await SizeChart.collection.insertOne({ _id: legacyId, store: 'b2c', ...chartInput, images: { en: image, ar: null }, alt: { en: '', ar: '' },
      version: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() });
    const legacy = (await charts.publicForProducts('b2c', [String(legacyId)], 'ar')).get(String(legacyId));
    assert.equal(legacy.measurements, null); assert.equal(legacy.image.id, image.id);
    await reassign(a._id, null); await charts.remove('b2c', actor, first.id);
    assert.equal(await SizeChart.findById(first.id), null); assert.ok(await Product.findById(c._id));
  });
