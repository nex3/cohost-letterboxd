import {Component, EventEmitter, ViewChild, ElementRef} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {FormBuilder, FormControl, Validators} from '@angular/forms';
import {Observable, catchError, filter, map, switchMap, tap} from 'rxjs';
import {MatSnackBar} from '@angular/material/snack-bar';

const reviewUrlPattern = /^https:\/\/(www\.)?backloggd\.com\/u\/[^\/]+\/review\/[0-9]+\/?$/;

interface ReviewInfo {
  url: URL;
  date: string;
  reviewer: string;
  reviewerUrl: URL;
  reviewerAvatar: URL;
  game: string;
  gameUrl: URL;
  platform: string;
  platformUrl: URL;
  starsPercentage: string;
  body: string;
  image: URL|null;
  mastered: boolean;
  backer: boolean;
  replay: boolean;
  status: string;
  statusUrl: URL;
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
    includeImage: new FormControl(true),
    attribution: new FormControl(true),
  });

  loading = false;
  reviewChanges: Observable<ReviewInfo|null>;

  statusColors: Record<string, string> = {
    'Played': '#ea377a',
    'Completed': '#43b94f',
    'Mastered': '#8d58af',
    'Abandoned': '#ea4747',
    'Retired': '#4b7bd4',
    'Shelved': '#e69b3e',
  };

  @ViewChild('result') private wrapper!: ElementRef<HTMLElement>;

  constructor(private _formBuilder: FormBuilder, private _http: HttpClient, private _snackBar: MatSnackBar) {
    this.reviewChanges = this.form.controls.url.valueChanges.pipe(
      filter(val => !val || !!val.match(reviewUrlPattern)),
      switchMap(val => {
        if (!val) return Promise.resolve(null);
        this.loading = true;
        return this._http.get(val, {responseType: 'text', observe: 'response'}).pipe(
          catchError(error => {
            console.error(error);
            return Promise.resolve(null);
          })
        );
      }),
      switchMap(reviewResponse => {
        if (!reviewResponse) return Promise.resolve(null);

        const doc = domParser.parseFromString(reviewResponse.body!, 'text/html');
        const usernameLink = doc.querySelector('.username-link a') as HTMLElement;
        const gameLink = doc.querySelector('.review-card a[href^="/games/"]') as HTMLElement;
        const gameUrl = new URL(gameLink.getAttribute('href')!, reviewResponse.url!);
        const platformLink = doc.querySelector('.review-platform') as HTMLElement;
        const statusLink = doc.querySelector('.game-status a') as HTMLElement;
        const reviewInfoWithoutImage = {
          url: new URL(reviewResponse.url!),
          date: Array.from(doc.querySelectorAll('.review-card p'))
              .map(el => (el as HTMLElement).innerText)
              .filter(text => text.startsWith('Reviewed on '))
              .map(text => text.substring('Reviewed on '.length))
              [0],
          reviewer: usernameLink.innerText.trim(),
          reviewerUrl: new URL(usernameLink.getAttribute('href')!, reviewResponse.url!),
          reviewerAvatar: new URL(doc.querySelector('#avatar img')!.getAttribute('src')!, reviewResponse.url!),
          game: gameLink.innerText.trim(),
          gameUrl,
          platform: platformLink.innerText.trim(),
          platformUrl: new URL(platformLink.getAttribute('href')!, reviewResponse.url!),
          starsPercentage: (doc.querySelector('.stars-top') as HTMLElement).style['width'],
          body: doc.querySelector('.review-body p')!.innerHTML,
          mastered: !!doc.querySelector('.mastered-icon'),
          backer: !!doc.querySelector('.backer-badge'),
          replay: !!doc.querySelector('.review-card .fa-history'),
          status: statusLink.innerText.trim(),
          statusUrl: new URL(statusLink.getAttribute('href')!, reviewResponse.url!),
        };

        return this._http.get(gameUrl.toString(), {responseType: 'text', observe: 'response'}).pipe(
          catchError(error => {
            console.error(error);
            return Promise.resolve(null);
          }),
          map(gameResponse => {
            return {
              ...reviewInfoWithoutImage,
              image: gameResponse ?
                new URL(
                    domParser.parseFromString(gameResponse.body!, 'text/html')
                        .querySelector('#artwork-high-res')!.getAttribute('src')!,
                    gameResponse.url!) :
                null,
            };
          })
        );
      }),
      tap(() => this.loading = false),
    );
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
