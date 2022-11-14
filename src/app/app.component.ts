import {Component, EventEmitter, ViewChild, ElementRef} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {FormBuilder, FormControl, Validators} from '@angular/forms';
import {Observable, catchError, filter, firstValueFrom, switchMap, tap} from 'rxjs';
import {MatSnackBar} from '@angular/material/snack-bar';

const reviewUrlPattern = /^https:\/\/(www\.)?letterboxd\.com\/[^\/]+\/film\/[^\/]+\/([\d]+\/)?$|^https:\/\/boxd\.it\//;

interface ReviewInfo {
  url: URL;
  reviewer: string;
  reviewerUrl: URL;
  reviewerAvatar: URL;
  reviewYear: string;
  reviewYearUrl: URL;
  reviewMonth: string;
  reviewMonthUrl: URL;
  reviewDay: string;
  reviewDayUrl: URL;
  film: string;
  filmUrl: URL;
  filmYear: string;
  starsPercentage: number|null;
  body: string;
  poster: URL|null;
  image: URL|null;
  patron: boolean;
}

const domParser = new DOMParser();

/** @title Form field appearance variants */
@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {
  form = this._formBuilder.group({
    url: new FormControl("", [
      Validators.pattern(reviewUrlPattern)
    ]),
    includePoster: new FormControl(true),
    includeImage: new FormControl(true),
    attribution: new FormControl(true),
  });

  loading = false;
  reviewChanges: Observable<ReviewInfo|null>;

  @ViewChild('result') private wrapper!: ElementRef<HTMLElement>;

  constructor(private _formBuilder: FormBuilder, private _http: HttpClient, private _snackBar: MatSnackBar) {
    this.reviewChanges = this.form.controls.url.valueChanges.pipe(
      filter(val => !val || !!val.match(reviewUrlPattern)),
      switchMap(val => {
        if (!val) return Promise.resolve(null);
        this.loading = true;
        return this._http.get(this.proxyUrl(val), {responseType: 'text', observe: 'response'}).pipe(
          catchError(error => {
            console.error(error);
            return Promise.resolve(null);
          })
        );
      }),
      switchMap(reviewResponse => {
        if (!reviewResponse) return Promise.resolve(null);

        const url = this.deproxyUrl(reviewResponse.url!);
        const doc = domParser.parseFromString(reviewResponse.body!, 'text/html');
        const usernameLink = doc.querySelector('.person-summary a.name') as HTMLElement;
        const reviewerUrl = new URL(usernameLink.getAttribute('href')!, url);

        const dateLinks = doc.querySelector('.date-links') as HTMLElement;
        let reviewMonth: string;
        let reviewDay: string;
        let reviewYear: string;
        if (dateLinks.querySelector('a')) {
          reviewMonth = (dateLinks.querySelector('a:nth-child(1)') as HTMLElement).innerText.trim();
          reviewDay = (dateLinks.querySelector('a:nth-child(2)') as HTMLElement).innerText.trim();
          reviewYear = (dateLinks.querySelector('a:nth-child(3)') as HTMLElement).innerText.trim();
        } else {
          [reviewDay, reviewMonth, reviewYear] = dateLinks.innerText.trim().split(' ');
        }
        const reviewYearUrl = new URL(`${reviewerUrl}/films/diary/for/${reviewYear}/`);
        const reviewMonthUrl = new URL(`${reviewYearUrl}${new Date(Date.parse(`${reviewMonth} 1`)).getMonth() + 1}/`);
        const reviewDayUrl = new URL(`${reviewMonthUrl}${reviewDay}/`);

        const filmLink = doc.querySelector('.film-title-wrapper > a') as HTMLElement;
        const filmUrl = new URL(filmLink.getAttribute('href')!, url);
        const stars = doc.querySelector('.rating') as HTMLElement|undefined;
        let starsPercentage: number|null = null;
        if (stars) {
          const match = stars.getAttribute('class')?.match(/rated-large-([0-9]+)/);
          if (match && match[1]) {
            starsPercentage = parseInt(match[1])/10;
          }
        }
        const reviewInfo: ReviewInfo = {
          url,
          reviewer: (usernameLink.querySelector('span:first-child') as HTMLElement).innerText.trim(),
          reviewerUrl,
          reviewerAvatar: new URL(doc.querySelector('.avatar img')!.getAttribute('src')!, url),
          reviewYear,
          reviewYearUrl,
          reviewMonth,
          reviewMonthUrl,
          reviewDay,
          reviewDayUrl,
          film: filmLink.innerText.trim(),
          filmUrl,
          filmYear: (doc.querySelector('.film-title-wrapper .metadata') as HTMLElement).innerText,
          poster: new URL(doc.querySelector('.poster img')!.getAttribute('src')!, url),
          starsPercentage,
          body: doc.querySelector('.review.body-text > div > div')!.innerHTML,
          image: null,
          patron: !!usernameLink.querySelector('.badge.-patron'),
        };

        return this._http.get(this.proxyUrl(filmUrl), {responseType: 'text', observe: 'response'}).pipe(
          catchError(error => {
            console.error(error);
            return Promise.resolve(null);
          }),
          switchMap(async filmResponse => {
            if (filmResponse) {
              const image = domParser.parseFromString(filmResponse.body!, 'text/html')
                          .querySelector('.backdrop-wrapper') as HTMLElement;
              const urlString = image?.dataset['backdrop'];
              reviewInfo.image = urlString ? new URL(urlString, this.deproxyUrl(reviewResponse.url!)) : null;
            }

            const urlComponents = filmUrl.pathname.split('/');
            const filmSlug = urlComponents[urlComponents.length - 2];
            const posterResponse = await firstValueFrom(
              this._http.get(this.proxyUrl(`https://letterboxd.com/ajax/poster/film/${filmSlug}/hero/300x450/`), {responseType: 'text', observe: 'response'}).pipe(
              catchError(error => {
                console.error(error);
                return Promise.resolve(null);
              })));

            if (posterResponse) {
              const poster = domParser.parseFromString(posterResponse.body!, 'text/html')
                  .querySelector(".image:not(.hidden)") as HTMLImageElement;
              const urlString = poster?.getAttribute('src');
              reviewInfo.poster = urlString ? new URL(urlString, this.deproxyUrl(reviewResponse.url!)) : null;
            }

            return reviewInfo;
          }),
        );
      }),
      tap(() => this.loading = false),
    );
  }

  proxyUrl(url: string|URL): string {
    return `https://letterboxd-cors-proxy.herokuapp.com/${url}`;
  }

  deproxyUrl(url: string|URL): URL {
    if (typeof url === 'string') url = new URL(url);
    if (url.pathname.startsWith('/http')) {
      return new URL(url.pathname.substring(1));
    } else {
      return url;
    }
  }

  stars(starsPercentage: number): string {
    const rating = Math.round(starsPercentage * 10);
    return '★'.repeat(Math.floor(rating/2)) + (rating % 2 === 0 ? '' : '½');
  }

  async copyHtml(): Promise<void> {
    const html = this.wrapper.nativeElement.innerHTML
      // Angular adds a bunch of comments that we don't need.
      .replace(/<!--(.|\n)*?-->/mg, '')
      // Magic Angular attributes.
      .replace(/ _ng[a-z0-9-]+=""/g, '')
      // Angular-injected class.
      .replace(/ class="ng-star-inserted"/g, '');
    await navigator.clipboard.writeText(html);
    this._snackBar.open("HTML copied!", undefined, { duration: 1000 });
  }
}
