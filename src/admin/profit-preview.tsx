import React from 'react';
import { assertPricePackage, minimumPackagePrice, shippingScenarios } from '../shared/domain';
import type { Product, Settings, ShippingCosts } from '../shared/types';

export function ProfitPreview({
  product,
  settings,
  maximumShipping,
  shippingCosts,
  options,
  t,
  money,
}: {
  product: Product;
  settings: Settings;
  maximumShipping: number | null;
  shippingCosts: ShippingCosts | null;
  options: {
    label: string;
    total: number;
    quantity: number;
    freeShipping?: boolean;
    repeatable?: boolean;
  }[];
  t: (key: string) => string;
  money: (amount: number) => string;
}) {
  return (
    <div className="profit-preview" aria-label={t('الربح المتوقع بعد تكاليف مورد')}>
      <h4>{t('الربح المتوقع بعد تكاليف مورد')}</h4>
      {options.map((option, index) => {
        const wholesale =
          product.fulfillment == null ? null : product.fulfillment * option.quantity;
        const scenarios = shippingScenarios(
          option.total,
          wholesale,
          !!option.freeShipping,
          settings,
          product,
          shippingCosts,
        );
        let error = '';
        let minimum: number | null = null;
        if (
          wholesale !== null &&
          maximumShipping !== null &&
          Number.isSafeInteger(option.total) &&
          Number.isSafeInteger(wholesale)
        ) {
          minimum = minimumPackagePrice(
            wholesale,
            !!option.freeShipping,
            settings,
            product,
            maximumShipping,
          );
          if (option.repeatable)
            minimum = Math.max(
              minimum,
              Math.ceil(
                minimumPackagePrice(
                  wholesale * 100,
                  !!option.freeShipping,
                  settings,
                  product,
                  maximumShipping,
                ) / 100,
              ),
            );
          try {
            assertPricePackage(
              option.total,
              wholesale,
              !!option.freeShipping,
              settings,
              product,
              maximumShipping,
            );
            if (option.repeatable)
              assertPricePackage(
                option.total * 100,
                wholesale * 100,
                !!option.freeShipping,
                settings,
                product,
                maximumShipping,
              );
          } catch (e) {
            error = (e as Error).message;
          }
        }
        const renderScenarios = (mode: 'cart' | 'direct') => (
          <div className="profit-scenarios">
            {scenarios
              .filter((scenario) => scenario.mode === mode)
              .map((p) => (
                <div
                  className={
                    'profit-scenario ' +
                    (p.profit === null || p.profit < 0
                      ? 'loss'
                      : p.profit === 0
                        ? 'break-even'
                        : 'gain')
                  }
                  key={p.area}
                >
                  <b>{t(p.area === 'casa' ? 'الدار البيضاء' : 'باقي المدن')}</b>
                  <dl>
                    <div>
                      <dt>{t('توصيل يدفعه الزبون')}</dt>
                      <dd>{money(p.customerShipping)}</dd>
                    </div>
                    <div>
                      <dt>{t('توصيل مستحق لمورد')}</dt>
                      <dd>{p.shippingCost === null ? t('غير متاح') : money(p.shippingCost)}</dd>
                    </div>
                    <div>
                      <dt>{t('الإجمالي الذي يدفعه الزبون')}</dt>
                      <dd>{money(p.total)}</dd>
                    </div>
                    <div className="profit-result">
                      <dt>{t('الربح المتوقع')}</dt>
                      <dd>
                        {p.profit === null ? t('غير متاح') : money(p.profit)}
                        {p.profit === 0 && <small>{t('تعادل: لا يوجد ربح')}</small>}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
          </div>
        );
        const differs = scenarios.some(
          (p) =>
            p.mode === 'cart' &&
            p.customerShipping !==
              scenarios.find((v) => v.mode === 'direct' && v.area === p.area)?.customerShipping,
        );
        return (
          <div
            className={'profit-row ' + (minimum === null || error ? 'loss' : 'gain')}
            key={index}
          >
            <b>{t(option.label)}</b>
            <dl>
              <div>
                <dt>{t('سعر المنتجات للزبون دون توصيل')}</dt>
                <dd>{money(option.total)}</dd>
              </div>
              <div>
                <dt>{t('تكلفة المنتجات لدى مورد دون توصيل')}</dt>
                <dd>{wholesale === null ? t('غير متاحة') : money(wholesale)}</dd>
              </div>
              <div>
                <dt>{t('أعلى تكلفة توصيل للحماية')}</dt>
                <dd>{maximumShipping === null ? t('غير متاح') : money(maximumShipping)}</dd>
              </div>
              <div className="minimum-price">
                <dt>{t('أقل سعر مسموح للعرض دون توصيل')}</dt>
                <dd>{minimum === null ? t('غير متاح') : money(minimum)}</dd>
              </div>
            </dl>
            <h5>{t('عند الشراء مباشرة من صفحة المنتج')}</h5>
            {renderScenarios('direct')}
            {differs && (
              <details className="cart-profit-scenarios">
                <summary>{t('الربح عند الشراء من السلة')}</summary>
                {renderScenarios('cart')}
              </details>
            )}
            {error && <p className="field-error">{t(error)}</p>}
            {minimum === null && (
              <p className="field-error">
                {t('حدّث بيانات مورد للحصول على تكلفة موثوقة قبل تفعيل البيع.')}
              </p>
            )}
          </div>
        );
      })}
      <small className="muted">
        {t(
          'سعر المنتجات منفصل عن التوصيل. الربح = إجمالي الزبون − تكلفة المنتجات − توصيل مورد للمنطقة. الحماية تعتمد أعلى تكلفة رسمية.',
        )}
      </small>
    </div>
  );
}
